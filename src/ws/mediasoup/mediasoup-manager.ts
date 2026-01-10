import * as mediasoup from "mediasoup";
import { mediasoupConfig } from "./mediasoup-config";

export class MediasoupManager {
  private static instance: MediasoupManager;
  private workers: mediasoup.types.Worker[] = [];
  private nextWorkerIdx = 0;
  private routers: Map<string, mediasoup.types.Router> = new Map(); // roomId -> Router

  private constructor() {}

  public static async getInstance(): Promise<MediasoupManager> {
    if (!MediasoupManager.instance) {
      MediasoupManager.instance = new MediasoupManager();
      await MediasoupManager.instance.init();
    }
    return MediasoupManager.instance;
  }

  private async init() {
    for (let i = 0; i < 2; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: mediasoupConfig.worker.logLevel,
        logTags: mediasoupConfig.worker.logTags,
        rtcMinPort: mediasoupConfig.worker.rtcMinPort,
        rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
      });

      worker.on("died", () => {
        console.error(
          "mediasoup worker died, exiting in 2 seconds... [pid:%d]",
          worker.pid
        );
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push(worker);
    }
    console.log("🚀 Mediasoup Workers started");
  }

  private getNextWorker(): mediasoup.types.Worker {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  public async getOrCreateRouter(
    roomId: string
  ): Promise<mediasoup.types.Router> {
    let router = this.routers.get(roomId);
    if (!router) {
      const worker = this.getNextWorker();
      router = await worker.createRouter({
        mediaCodecs: mediasoupConfig.router.mediaCodecs,
      });
      this.routers.set(roomId, router);
      console.log(`📡 Mediasoup Router created for room: ${roomId}`);
    }
    return router;
  }

  public async createWebRtcTransport(
    router: mediasoup.types.Router
  ): Promise<mediasoup.types.WebRtcTransport> {
    const transport = await router.createWebRtcTransport({
      listenIps: mediasoupConfig.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate:
        mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
    });

    return transport;
  }
}

export const mediasoupManager = MediasoupManager;
