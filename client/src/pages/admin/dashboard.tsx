import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Camera, Image, Video, AlertTriangle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Camera as CameraType, Client, Timelapse } from "@shared/schema";

interface DashboardStats {
  totalClients: number;
  activeClients: number;
  totalCameras: number;
  onlineCameras: number;
  offlineCameras: number;
  todayCaptures: number;
  processingTimelapses: number;
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: offlineCameras, isLoading: camerasLoading } = useQuery<CameraType[]>({
    queryKey: ["/api/admin/cameras/offline"],
  });

  const { data: recentTimelapses, isLoading: timelapsesLoading } = useQuery<Timelapse[]>({
    queryKey: ["/api/admin/timelapses/recent"],
  });

  return (
    <AdminLayout
      title="Dashboard"
      breadcrumbs={[
        { label: "Admin", href: "/admin/dashboard" },
        { label: "Dashboard" },
      ]}
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statsLoading ? (
            [...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <MetricCard
                title="Clientes Ativos"
                value={stats?.activeClients || 0}
                description={`${stats?.totalClients || 0} total`}
                icon={Users}
                iconClassName="text-blue-500"
              />
              <MetricCard
                title="Câmeras"
                value={`${stats?.onlineCameras || 0} / ${stats?.totalCameras || 0}`}
                description={`${stats?.offlineCameras || 0} offline`}
                icon={Camera}
                iconClassName={stats?.offlineCameras && stats.offlineCameras > 0 ? "text-amber-500" : "text-green-500"}
              />
              <MetricCard
                title="Capturas Hoje"
                value={stats?.todayCaptures || 0}
                description="fotos capturadas"
                icon={Image}
                iconClassName="text-purple-500"
              />
              <MetricCard
                title="Time-lapses"
                value={stats?.processingTimelapses || 0}
                description="em processamento"
                icon={Video}
                iconClassName="text-amber-500"
              />
            </>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Câmeras Offline
              </CardTitle>
              <CardDescription>
                Câmeras que precisam de atenção
              </CardDescription>
            </CardHeader>
            <CardContent>
              {camerasLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-4 w-4 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : !offlineCameras || offlineCameras.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                    <Camera className="h-6 w-6 text-green-500" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Todas as câmeras online</p>
                  <p className="text-xs text-muted-foreground">Nenhum problema detectado</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {offlineCameras.map((camera) => (
                    <div
                      key={camera.id}
                      className="flex items-center justify-between rounded-md border p-3"
                      data-testid={`camera-offline-${camera.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <StatusDot status="offline" />
                        <div>
                          <p className="text-sm font-medium">{camera.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {camera.ultimaCaptura
                              ? `Última captura: ${formatDistanceToNow(new Date(camera.ultimaCaptura), { addSuffix: true, locale: ptBR })}`
                              : "Sem capturas"}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status="offline" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-500" />
                Time-lapses Recentes
              </CardTitle>
              <CardDescription>
                Últimos time-lapses gerados
              </CardDescription>
            </CardHeader>
            <CardContent>
              {timelapsesLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !recentTimelapses || recentTimelapses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Video className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Nenhum time-lapse ainda</p>
                  <p className="text-xs text-muted-foreground">Crie seu primeiro time-lapse</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTimelapses.map((timelapse) => (
                    <div
                      key={timelapse.id}
                      className="flex items-center justify-between rounded-md border p-3"
                      data-testid={`timelapse-recent-${timelapse.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/10">
                          <Video className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{timelapse.nome || `Timelapse #${timelapse.id.slice(0, 8)}`}</p>
                          <p className="text-xs text-muted-foreground">
                            {timelapse.createdAt
                              ? formatDistanceToNow(new Date(timelapse.createdAt), { addSuffix: true, locale: ptBR })
                              : "Data desconhecida"}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={timelapse.status as any} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
