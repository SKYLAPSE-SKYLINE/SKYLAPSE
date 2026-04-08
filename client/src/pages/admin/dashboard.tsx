import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Camera, Image, Video, AlertTriangle, Clock,
  ArrowRight, HardDrive, Activity, Eye, Images,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fmtRelative } from "@/lib/date";
import type { Camera as CameraType, Timelapse } from "@shared/schema";

interface DashboardStats {
  totalClients: number;
  activeClients: number;
  totalCameras: number;
  onlineCameras: number;
  offlineCameras: number;
  todayCaptures: number;
  processingTimelapses: number;
}

interface DashboardExtra {
  activityDays: { dia: string; total: number }[];
  storageBytes: number;
  totalCaptures: number;
}

type CameraWithLocation = CameraType & {
  localidade?: { nome: string } | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function ActivityBar({ day, total, max, label }: { day: string; total: number; max: number; label: string }) {
  const pct = max > 0 ? (total / max) * 100 : 0;
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      <span className="text-xs text-zinc-300">{total}</span>
      <div className="w-full bg-zinc-800 rounded-sm overflow-hidden" style={{ height: 48 }}>
        <div
          className="w-full bg-blue-500/70 rounded-sm transition-all duration-500"
          style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-500">{label}</span>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/stats"],
    refetchInterval: 60_000,
  });

  const { data: offlineCameras, isLoading: camerasLoading } = useQuery<CameraType[]>({
    queryKey: ["/api/admin/cameras/offline"],
    refetchInterval: 60_000,
  });

  const { data: allCameras, isLoading: allCamerasLoading } = useQuery<CameraWithLocation[]>({
    queryKey: ["/api/admin/cameras"],
    refetchInterval: 60_000,
  });

  const { data: recentTimelapses, isLoading: timelapsesLoading } = useQuery<Timelapse[]>({
    queryKey: ["/api/admin/timelapses/recent"],
    refetchInterval: 60_000,
  });

  const { data: extra } = useQuery<DashboardExtra>({
    queryKey: ["/api/admin/dashboard-extra"],
    refetchInterval: 60_000,
  });

  // Build last 7 days labels
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });
  const activityMap = Object.fromEntries((extra?.activityDays || []).map((r) => [r.dia, r.total]));
  const maxCaptures = Math.max(...last7.map((d) => activityMap[d] || 0), 1);

  const dayLabels: Record<string, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };

  return (
    <AdminLayout title="Dashboard">
      <div className="space-y-8">

        {/* ── Stats ── */}
        {statsLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800/50 p-4 space-y-2">
                <Skeleton className="h-3 w-20 bg-zinc-800" />
                <Skeleton className="h-8 w-14 bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                icon: <Users className="h-4 w-4 text-blue-400" />,
                label: "Clientes ativos",
                value: stats?.activeClients ?? 0,
                sub: `${stats?.totalClients ?? 0} cadastrados`,
              },
              {
                icon: <Camera className="h-4 w-4 text-emerald-400" />,
                label: "Câmeras online",
                value: `${stats?.onlineCameras ?? 0}/${stats?.totalCameras ?? 0}`,
                sub: stats?.offlineCameras ? `${stats.offlineCameras} offline` : "todas online",
                accent: stats?.offlineCameras ? "text-amber-400" : "text-emerald-400",
              },
              {
                icon: <Image className="h-4 w-4 text-violet-400" />,
                label: "Capturas hoje",
                value: stats?.todayCaptures ?? 0,
                sub: extra ? `${extra.totalCaptures.toLocaleString("pt-BR")} no total` : "—",
              },
              {
                icon: <HardDrive className="h-4 w-4 text-orange-400" />,
                label: "Armazenamento",
                value: extra ? formatBytes(extra.storageBytes) : "—",
                sub: "pasta de capturas",
              },
            ].map((s, i) => (
              <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800/50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-zinc-400">
                  {s.icon}
                  <span className="text-xs uppercase tracking-wider">{s.label}</span>
                </div>
                <p className={`text-2xl font-semibold ${(s as any).accent || "text-white"}`}>{s.value}</p>
                {s.sub && <p className="text-xs text-zinc-500">{s.sub}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── Camera grid ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Camera className="h-4 w-4 text-blue-400" />
              Câmeras
            </h2>
            <Link href="/admin/cameras" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
              Gerenciar <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {allCamerasLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800/50 overflow-hidden">
                  <Skeleton className="aspect-[16/9] w-full bg-zinc-800" />
                  <div className="p-3 space-y-1.5">
                    <Skeleton className="h-4 w-2/3 bg-zinc-800" />
                    <Skeleton className="h-3 w-1/2 bg-zinc-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : !allCameras || allCameras.length === 0 ? (
            <div className="rounded-xl bg-zinc-900 border border-zinc-800/50 p-8 text-center">
              <Camera className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-400">Nenhuma câmera cadastrada</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {allCameras.map((cam) => (
                <div key={cam.id} className="group rounded-xl bg-zinc-900 border border-zinc-800/50 overflow-hidden hover:border-zinc-700 transition-colors">
                  {/* Thumbnail */}
                  <div className="relative aspect-[16/9] bg-zinc-800 overflow-hidden">
                    <img
                      src={`/api/admin/cameras/${cam.id}/thumbnail`}
                      alt={cam.nome}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <Camera className="absolute inset-0 m-auto h-7 w-7 text-zinc-700" />

                    {/* Status */}
                    <div className="absolute top-2 left-2">
                      <div className={`w-2.5 h-2.5 rounded-full border-2 border-black/40 ${
                        cam.status === "online"
                          ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                          : "bg-red-400"
                      }`} />
                    </div>

                    {/* Quick actions on hover */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Link
                        href={`/admin/cameras/${cam.id}/live`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-white/35 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> Ao Vivo
                      </Link>
                      <Link
                        href={`/admin/cameras/${cam.id}/galeria`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-white/35 transition-colors"
                      >
                        <Images className="h-3.5 w-3.5" /> Galeria
                      </Link>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <p className="text-sm font-medium text-white truncate">{cam.nome}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-zinc-500 truncate">
                        {cam.localidade?.nome || "Sem localidade"}
                      </span>
                      <span className={`text-[10px] font-medium ${cam.status === "online" ? "text-emerald-400" : "text-red-400"}`}>
                        {cam.status === "online" ? "Online" : "Offline"}
                      </span>
                    </div>
                    {cam.ultimaCaptura && (
                      <p className="text-[10px] text-zinc-600 mt-1">
                        {fmtRelative(cam.ultimaCaptura)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-zinc-800/60" />

        {/* ── Activity chart + Offline + Timelapses ── */}
        <div className="grid gap-8 lg:grid-cols-3">

          {/* Activity chart */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              Capturas — últimos 7 dias
            </h2>
            <div className="rounded-xl bg-zinc-900 border border-zinc-800/50 p-4">
              {!extra ? (
                <div className="h-20 flex items-end gap-2">
                  {[...Array(7)].map((_, i) => (
                    <Skeleton key={i} className="flex-1 bg-zinc-800 rounded-sm" style={{ height: `${30 + Math.random() * 50}%` }} />
                  ))}
                </div>
              ) : (
                <div className="flex items-end gap-1.5">
                  {last7.map((dia) => {
                    const d = new Date(dia + "T12:00:00");
                    return (
                      <ActivityBar
                        key={dia}
                        day={dia}
                        total={activityMap[dia] || 0}
                        max={maxCaptures}
                        label={dayLabels[d.getDay()]}
                      />
                    );
                  })}
                </div>
              )}
              {extra && (
                <p className="text-xs text-zinc-500 mt-3 text-center">
                  Total 7 dias: {last7.reduce((s, d) => s + (activityMap[d] || 0), 0).toLocaleString("pt-BR")} capturas
                </p>
              )}
            </div>
          </div>

          {/* Offline cameras */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Câmeras offline
              </h2>
              <Link href="/admin/cameras" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
                Ver todas <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {camerasLoading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 w-full bg-zinc-900 rounded-lg" />)}
              </div>
            ) : !offlineCameras || offlineCameras.length === 0 ? (
              <div className="rounded-xl bg-zinc-900 border border-zinc-800/50 p-5 text-center">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-2">
                  <Camera className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-sm text-zinc-300">Todas online</p>
                <p className="text-xs text-zinc-500 mt-0.5">Nenhum problema detectado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {offlineCameras.map((camera) => (
                  <Link
                    key={camera.id}
                    href={`/admin/cameras/${camera.id}/live`}
                    className="flex items-center justify-between rounded-lg bg-zinc-900 border border-zinc-800/50 px-4 py-3 hover:bg-zinc-800/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      <div>
                        <p className="text-sm font-medium text-white">{camera.nome}</p>
                        <p className="text-xs text-zinc-500">
                          {camera.ultimaCaptura ? fmtRelative(camera.ultimaCaptura) : "Sem capturas"}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-red-400 font-medium">Offline</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent timelapses */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-400" />
                Timelapses recentes
              </h2>
              <Link href="/admin/timelapses" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
                Ver todos <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {timelapsesLoading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12 w-full bg-zinc-900 rounded-lg" />)}
              </div>
            ) : !recentTimelapses || recentTimelapses.length === 0 ? (
              <div className="rounded-xl bg-zinc-900 border border-zinc-800/50 p-5 text-center">
                <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-2">
                  <Video className="h-4 w-4 text-zinc-500" />
                </div>
                <p className="text-sm text-zinc-300">Nenhum timelapse</p>
                <p className="text-xs text-zinc-500 mt-0.5">Crie seu primeiro timelapse</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTimelapses.map((tl) => {
                  const statusColor = tl.status === "concluido" ? "text-emerald-400" : tl.status === "erro" ? "text-red-400" : "text-blue-400";
                  const statusLabel = tl.status === "concluido" ? "Pronto" : tl.status === "erro" ? "Erro" : tl.status === "processando" ? "Gerando..." : "Na fila";
                  return (
                    <div key={tl.id} className="flex items-center justify-between rounded-lg bg-zinc-900 border border-zinc-800/50 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-zinc-800 flex items-center justify-center shrink-0">
                          <Video className="h-4 w-4 text-zinc-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{tl.nome || `Timelapse #${tl.id.slice(0, 6)}`}</p>
                          <p className="text-xs text-zinc-500">
                            {tl.createdAt ? fmtRelative(tl.createdAt) : ""}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[10px] uppercase tracking-wider font-medium shrink-0 ml-2 ${statusColor}`}>{statusLabel}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}
