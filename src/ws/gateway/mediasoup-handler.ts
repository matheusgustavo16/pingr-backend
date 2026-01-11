import * as mediasoup from "mediasoup";
import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { MediasoupManager } from "../mediasoup/mediasoup-manager";

// Mapas para gerenciar o estado em memória (vincular ao Socket ID)
const transports = new Map<
  string,
  Map<string, mediasoup.types.WebRtcTransport>
>(); // socketId -> transportId -> Transport
const producers = new Map<string, Map<string, mediasoup.types.Producer>>(); // socketId -> producerId -> Producer
const consumers = new Map<string, Map<string, mediasoup.types.Consumer>>(); // socketId -> consumerId -> Consumer

export const handleMediasoupEvents = async (
  io: SocketIOServer,
  socket: AuthenticatedSocket
) => {
  const manager = await MediasoupManager.getInstance();

  // 1. Obter capacidades do roteador da sala
  socket.on(
    "MEDIASOUP_GET_ROUTER_CAPABILITIES",
    async (data: { roomId: string }, callback) => {
      try {
        const router = await manager.getOrCreateRouter(data.roomId);
        callback({ rtpCapabilities: router.rtpCapabilities });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 1.1 Obter Producers existentes na sala
  socket.on("MEDIASOUP_GET_PRODUCERS", (data: { roomId: string }, callback) => {
    const roomProducers: any[] = [];

    producers.forEach((socketProducers, socketId) => {
      // Ignorar o próprio socket
      if (socketId === socket.id) return;

      socketProducers.forEach((producer) => {
        if (producer.appData.roomId === data.roomId) {
          roomProducers.push({
            producerId: producer.id,
            userId: (io.sockets.sockets.get(socketId) as any)?.user?.id,
            kind: producer.kind,
            appData: producer.appData,
          });
        }
      });
    });

    callback({ producers: roomProducers });
  });

  // 2. Criar WebRtcTransport
  socket.on(
    "MEDIASOUP_CREATE_TRANSPORT",
    async (data: { roomId: string; direction: "send" | "recv" }, callback) => {
      try {
        const router = await manager.getOrCreateRouter(data.roomId);
        const transport = await manager.createWebRtcTransport(router);

        // Armazenar transporte
        if (!transports.has(socket.id)) transports.set(socket.id, new Map());
        transports.get(socket.id)!.set(transport.id, transport);

        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        });

        transport.on("dtlsstatechange", (dtlsState: string) => {
          if (dtlsState === "closed") transport.close();
        });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 3. Conectar Transport
  socket.on(
    "MEDIASOUP_CONNECT_TRANSPORT",
    async (data: { transportId: string; dtlsParameters: any }, callback) => {
      try {
        const transport = transports.get(socket.id)?.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        await transport.connect({ dtlsParameters: data.dtlsParameters });
        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 4. Produzir Mídia
  socket.on(
    "MEDIASOUP_PRODUCE",
    async (
      data: {
        transportId: string;
        kind: "audio" | "video";
        rtpParameters: any;
        appData?: any;
      },
      callback
    ) => {
      try {
        const transport = transports.get(socket.id)?.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        const producer = await transport.produce({
          kind: data.kind,
          rtpParameters: data.rtpParameters,
          appData: data.appData,
        });

        if (!producers.has(socket.id)) producers.set(socket.id, new Map());
        producers.get(socket.id)!.set(producer.id, producer);

        callback({ id: producer.id });

        // Notificar outros na sala sobre o novo producer
        const roomId = (transport as any)._data?.roomId || data.appData?.roomId;
        if (roomId) {
          socket.to(roomId).emit("NEW_PRODUCER", {
            producerId: producer.id,
            userId: socket.user?.id,
            kind: producer.kind,
            appData: producer.appData,
          });
        }
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 5. Consumir Mídia
  socket.on(
    "MEDIASOUP_CONSUME",
    async (
      data: { transportId: string; producerId: string; rtpCapabilities: any },
      callback
    ) => {
      try {
        const transport = transports.get(socket.id)?.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        // Encontrar o producer em todos os sockets (SFU)
        let targetProducer: mediasoup.types.Producer | undefined;
        for (const socketProducers of producers.values()) {
          if (socketProducers.has(data.producerId)) {
            targetProducer = socketProducers.get(data.producerId);
            break;
          }
        }

        if (!targetProducer) throw new Error("Producer not found");

        const roomId = targetProducer.appData.roomId;
        if (!roomId)
          throw new Error("Producer has no roomId provided in appData");

        const router = await manager.getOrCreateRouter(roomId as string);

        if (
          !router.canConsume({
            producerId: data.producerId,
            rtpCapabilities: data.rtpCapabilities,
          })
        ) {
          throw new Error("Cannot consume");
        }

        const consumer = await transport.consume({
          producerId: data.producerId,
          rtpCapabilities: data.rtpCapabilities,
          paused: true, // Começar pausado para evitar race conditions
        });

        if (!consumers.has(socket.id)) consumers.set(socket.id, new Map());
        consumers.get(socket.id)!.set(consumer.id, consumer);

        callback({
          id: consumer.id,
          producerId: data.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 6. Resumir Consumer
  socket.on(
    "MEDIASOUP_RESUME_CONSUMER",
    async (data: { consumerId: string }, callback) => {
      try {
        const consumer = consumers.get(socket.id)?.get(data.consumerId);
        if (!consumer) throw new Error("Consumer not found");

        await consumer.resume();
        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    const userTransports = transports.get(socket.id);
    if (userTransports) {
      userTransports.forEach((t) => t.close());
      transports.delete(socket.id);
    }
    producers.delete(socket.id);
    consumers.delete(socket.id);
  });
};
