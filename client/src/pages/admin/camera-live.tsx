import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Images, AlertCircle, Wifi, Monitor, Eye, Clock } from "lucide-react";
import type { Camera as CameraType, Capture } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const STREAM_LIMIT_SECONDS = 60;

export default function CameraLivePage() {
  const params = useParams();
  const cameraId = params.id;
  const [streamActive, setStreamActive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(STREAM_LIMIT_SECONDS);
  const [timeExpired, setTimeExpired] = useState(false);

  useEffect(() => {
    if (!streamActive) return;
    setSecondsLeft(STREAM_LIMIT_SECONDS);
    setTimeExpired(false);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          setStreamActive(false);
          setTimeExpired(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [streamActive]);

  const { data: camera, isLoading: cameraLoading } = useQuery<CameraType>({
    queryKey: ["/api/admin/cameras", cameraId],
    refetchInterval: 60_000,
  });

  const { data: lastCapture } = useQuery<Capture>({
    queryKey: ["/api/admin/cameras", cameraId, "last-capture"],
    refetchInterval: 30000,
  });

  const streamUrl = (camera as any)?.streamUrl as string | null | undefined;
  const safeStreamUrl = streamUrl && /^https?:\/\//i.test(streamUrl) ? streamUrl : null;
  const liveStreamUrl = safeStreamUrl
    ? `${safeStreamUrl.replace(/\/$/, "")}/stream.html?src=camera1&mode=mse`
    : null;

  if (cameraLoading) {
    return (
      <AdminLayout title="Ao Vivo">
        <Skeleton className="h-96 w-full bg-zinc-800" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={`${camera?.nome || "Camera"} — Ao Vivo`}>
      <div className="space-y-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/cameras" className="text-zinc-500 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="h-5 w-px bg-zinc-800" />

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${camera?.status === "online" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "bg-zinc-500"}`} />
            <span className="text-sm text-zinc-300 font-medium">{camera?.nome}</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Link
              href={`/admin/cameras/${cameraId}/galeria`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors"
            >
              <Images className="h-3.5 w-3.5" />
              Galeria
            </Link>
          </div>
        </div>

        {/* Viewer */}
        <div className="flex justify-center">
        <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-700/50 shadow-[0_8px_30px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)] w-full max-w-5xl">
          <div className="aspect-video relative">
            {liveStreamUrl ? (
              streamActive ? (
                <>
                  <iframe
                    src={liveStreamUrl}
                    className="h-full w-full border-0"
                    allow="autoplay"
                    title={`Stream ao vivo — ${camera?.nome}`}
                    data-testid="iframe-live-stream"
                  />
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-medium tabular-nums">
                    <Clock className="h-3 w-3" />
                    0:{String(secondsLeft).padStart(2, "0")}
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-5">
                  <div className="w-20 h-20 rounded-full bg-zinc-800/80 flex items-center justify-center">
                    <Monitor className="h-8 w-8 text-zinc-500" />
                  </div>
                  <div className="text-center space-y-1.5">
                    <p className="text-white/80 text-sm font-medium">
                      {timeExpired ? "Tempo esgotado" : "Stream pausado"}
                    </p>
                    <p className="text-zinc-500 text-xs">
                      {timeExpired
                        ? "O limite de 1 minuto foi atingido. Retome se precisar."
                        : "Transmissao limitada a 1 minuto por sessao."}
                    </p>
                  </div>
                  <button
                    onClick={() => setStreamActive(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                    {timeExpired ? "Retomar transmissao" : "Iniciar transmissao"}
                  </button>
                </div>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <AlertCircle className="h-12 w-12 text-zinc-600" />
                <p className="text-zinc-400 text-sm">Stream ao vivo nao configurado para esta camera</p>
              </div>
            )}
          </div>
        </div>
        </div>

        {/* Info strip */}
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Status</p>
            <p className={`text-sm font-medium ${camera?.status === "online" ? "text-emerald-400" : "text-red-400"}`}>
              {camera?.status === "online" ? "Online" : "Offline"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Intervalo</p>
            <p className="text-sm text-zinc-300">{camera?.intervaloCaptura} min</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Ultima captura</p>
            <p className="text-sm text-zinc-300">
              {camera?.ultimaCaptura
                ? formatDistanceToNow(new Date(camera.ultimaCaptura), { addSuffix: true, locale: ptBR })
                : "Sem capturas"}
            </p>
          </div>
          {streamUrl && (
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider flex items-center gap-1">
                <Wifi className="h-3 w-3" /> Stream go2rtc
              </p>
              <p className="text-sm text-zinc-300 font-mono">{streamUrl}</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
