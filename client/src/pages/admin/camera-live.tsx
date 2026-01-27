import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { ArrowLeft, Maximize2, RefreshCw, Camera, Image } from "lucide-react";
import type { Camera as CameraType, Capture } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function CameraLivePage() {
  const params = useParams();
  const cameraId = params.id;
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: camera, isLoading: cameraLoading } = useQuery<CameraType>({
    queryKey: ["/api/admin/cameras", cameraId],
  });

  const { data: lastCapture, isLoading: captureLoading, refetch } = useQuery<Capture>({
    queryKey: ["/api/admin/cameras", cameraId, "last-capture"],
    refetchInterval: 5000,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      setRefreshKey((k) => k + 1);
    }, 5000);

    return () => clearInterval(interval);
  }, [refetch]);

  if (cameraLoading) {
    return (
      <AdminLayout
        breadcrumbs={[
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Câmeras", href: "/admin/cameras" },
          { label: "Ao Vivo" },
        ]}
      >
        <Skeleton className="h-96 w-full" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      breadcrumbs={[
        { label: "Admin", href: "/admin/dashboard" },
        { label: "Câmeras", href: "/admin/cameras" },
        { label: camera?.nome || "Câmera", href: `/admin/cameras/${cameraId}` },
        { label: "Ao Vivo" },
      ]}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" asChild>
              <Link href="/admin/cameras">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{camera?.nome}</h1>
                <StatusDot status={(camera?.status as "online" | "offline") || "offline"} />
              </div>
              <p className="text-sm text-muted-foreground">
                Visualização ao vivo - Atualiza a cada 5 segundos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/admin/cameras/${cameraId}/galeria`}>
                <Image className="mr-2 h-4 w-4" />
                Ver Galeria
              </Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Snapshot Atual
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                data-testid="button-refresh-snapshot"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              {captureLoading && !lastCapture ? (
                <Skeleton className="h-full w-full" />
              ) : lastCapture?.imagemUrl ? (
                <>
                  <img
                    key={`${lastCapture.id}-${refreshKey}`}
                    src={lastCapture.imagemUrl}
                    alt={`Captura de ${camera?.nome}`}
                    className="h-full w-full object-contain"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                    <div className="flex items-center justify-between text-white">
                      <div className="flex items-center gap-2">
                        <StatusDot status="online" />
                        <span className="text-sm font-medium">{camera?.nome}</span>
                      </div>
                      <span className="text-xs opacity-80">
                        {lastCapture.capturadoEm
                          ? formatDistanceToNow(new Date(lastCapture.capturadoEm), {
                              addSuffix: true,
                              locale: ptBR,
                            })
                          : "Agora"}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center">
                  <Camera className="h-16 w-16 text-muted-foreground/30" />
                  <p className="mt-4 text-muted-foreground">Nenhuma captura disponível</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="mt-1">
                <StatusBadge status={(camera?.status as "online" | "offline") || "offline"} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Intervalo de Captura</p>
              <p className="mt-1 font-medium">{camera?.intervaloCaptura} minutos</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Última Captura</p>
              <p className="mt-1 font-medium">
                {camera?.ultimaCaptura
                  ? formatDistanceToNow(new Date(camera.ultimaCaptura), {
                      addSuffix: true,
                      locale: ptBR,
                    })
                  : "Sem capturas"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
