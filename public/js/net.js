// Signaling over WebSocket + WebRTC between the host (runs the emulator, player 1)
// and the guest (watches the host's video stream, sends inputs as player 2).

export class Signal {
  constructor() {
    this.handlers = {};
    this.queue = [];
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.queue.forEach((m) => this.ws.send(m));
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      (this.handlers[msg.type] || []).forEach((fn) => fn(msg));
    };
    this.ws.onclose = () => (this.handlers.close || []).forEach((fn) => fn());
  }

  on(type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
    return this;
  }

  send(obj) {
    const data = JSON.stringify(obj);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  close() {
    this.ws.onclose = null;
    this.ws.close();
  }
}

// Wires an RTCPeerConnection's negotiation to the signaling channel.
function connectPeer(signal, iceServers) {
  const pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = (e) => {
    if (e.candidate) signal.send({ type: "signal", data: { candidate: e.candidate } });
  };
  return pc;
}

const VIDEO_BITRATE = 2_500_000;

// Host side: streams `mediaStream` to whoever joins and receives their input.
export class HostLink {
  constructor({ signal, iceServers, getVideoTrack, onAudioStream, onInput, onMacro, onStatus }) {
    Object.assign(this, { signal, iceServers, getVideoTrack, onInput, onMacro, onStatus });
    this.pc = null;
    this.lastSeq = -1;
    this.audioTrack = null;
    onAudioStream((stream) => {
      this.audioTrack = stream.getAudioTracks()[0] || null;
      if (this.audioSender && this.audioTrack) this.audioSender.replaceTrack(this.audioTrack);
    });
    signal.on("peer-joined", () => this.start());
    signal.on("peer-left", () => this.stop("Соперник вышел"));
    signal.on("signal", (m) => this.handleSignal(m.data));
    // Fallback path if the data channel can't open: inputs relayed by the server.
    signal.on("input", (m) => this.handleInput(m.data));
  }

  async start() {
    this.stop();
    this.onStatus("connecting", "Соперник подключается…");
    const pc = (this.pc = connectPeer(this.signal, this.iceServers));
    const videoTrack = this.getVideoTrack();
    videoTrack.contentHint = "motion";
    const videoSender = pc.addTrack(videoTrack);
    this.audioSender = pc.addTransceiver("audio", { direction: "sendonly" }).sender;
    if (this.audioTrack) this.audioSender.replaceTrack(this.audioTrack);

    const input = pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
    input.onmessage = (e) => this.handleInput(JSON.parse(e.data));
    const ctl = (this.ctl = pc.createDataChannel("ctl"));
    ctl.onmessage = (e) => this.handleCtl(JSON.parse(e.data));

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") this.onStatus("connected", "Соперник в игре");
      if (s === "failed") this.onStatus("error", "Не удалось соединиться напрямую. Нужен TURN-сервер (см. README).");
      if (s === "disconnected") this.onStatus("connecting", "Связь с соперником прерывается…");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal.send({ type: "signal", data: { sdp: pc.localDescription } });
    this.tuneVideo(videoSender, videoTrack);
  }

  async tuneVideo(sender, track) {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    const height = track.getSettings().height || 480;
    params.encodings[0].maxBitrate = VIDEO_BITRATE;
    params.encodings[0].maxFramerate = 60;
    params.encodings[0].scaleResolutionDownBy = Math.max(1, height / 480);
    params.degradationPreference = "maintain-framerate";
    try {
      await sender.setParameters(params);
    } catch (e) {
      console.warn("setParameters", e);
    }
  }

  async handleSignal(data) {
    if (!this.pc) return;
    if (data.sdp) await this.pc.setRemoteDescription(data.sdp);
    if (data.candidate) await this.pc.addIceCandidate(data.candidate).catch(() => {});
  }

  handleInput(msg) {
    if (typeof msg.s !== "number" || msg.s <= this.lastSeq) return; // drop stale/out-of-order
    this.lastSeq = msg.s;
    this.onInput(msg.m | 0);
  }

  handleCtl(msg) {
    if (msg.ping !== undefined) this.ctl.send(JSON.stringify({ pong: msg.ping }));
    if (msg.rtt !== undefined) this.onStatus("connected", `Соперник в игре · пинг ${msg.rtt} мс`);
    if (msg.macro) this.onMacro(msg.macro);
  }

  stop(reason) {
    if (this.pc) this.pc.close();
    this.pc = null;
    this.ctl = null;
    this.lastSeq = -1;
    this.onInput(0);
    if (reason) this.onStatus("waiting", reason);
  }
}

// Guest side: shows the host's stream and sends input.
export class GuestLink {
  constructor({ signal, iceServers, video, onStatus }) {
    Object.assign(this, { signal, iceServers, video, onStatus });
    this.seq = 0;
    this.mask = 0;
    this.input = null;
    this.ctl = null;
    signal.on("signal", (m) => this.handleSignal(m.data));
    // Resend the current state regularly: the input channel is unreliable by design.
    this.resend = setInterval(() => this.sendMask(), 50);
    this.pinger = setInterval(() => this.sendCtl({ ping: performance.now() }), 2000);
  }

  async handleSignal(data) {
    if (data.sdp && data.sdp.type === "offer") {
      if (this.pc) this.pc.close();
      const pc = (this.pc = connectPeer(this.signal, this.iceServers));
      pc.ontrack = (e) => {
        if (e.track.kind === "video") {
          e.receiver.playoutDelayHint = 0; // Chrome: render frames as soon as they arrive
          e.receiver.jitterBufferTarget = 0;
        }
        const stream = this.video.srcObject instanceof MediaStream ? this.video.srcObject : new MediaStream();
        stream.addTrack(e.track);
        if (this.video.srcObject !== stream) this.video.srcObject = stream;
        // Audio and video arrive as two tracks; a second play() aborts the first (AbortError).
        // Only a real autoplay block needs the user's tap.
        this.video.play().catch((err) => {
          if (err.name === "NotAllowedError") this.onStatus("tap-for-sound");
        });
      };
      pc.ondatachannel = (e) => {
        if (e.channel.label === "input") this.input = e.channel;
        if (e.channel.label === "ctl") {
          this.ctl = e.channel;
          this.ctl.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.pong !== undefined) {
              const rtt = Math.round(performance.now() - msg.pong);
              this.onStatus("connected", `Пинг ${rtt} мс`);
              this.sendCtl({ rtt });
            }
          };
        }
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") this.onStatus("connected", "Подключено");
        if (s === "failed") this.onStatus("error", "Не удалось соединиться напрямую. Нужен TURN-сервер (см. README).");
        if (s === "disconnected") this.onStatus("connecting", "Связь прерывается…");
      };
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal.send({ type: "signal", data: { sdp: pc.localDescription } });
    } else if (data.candidate && this.pc) {
      await this.pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  setMask(mask) {
    if (mask === this.mask) return;
    this.mask = mask;
    this.sendMask();
  }

  sendMask() {
    const msg = { s: ++this.seq, m: this.mask };
    if (this.input && this.input.readyState === "open") this.input.send(JSON.stringify(msg));
    else this.signal.send({ type: "input", data: msg });
  }

  sendMacro(seq) {
    this.sendCtl({ macro: seq });
  }

  sendCtl(msg) {
    if (this.ctl && this.ctl.readyState === "open") this.ctl.send(JSON.stringify(msg));
  }

  close() {
    clearInterval(this.resend);
    clearInterval(this.pinger);
    if (this.pc) this.pc.close();
  }
}
