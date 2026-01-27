import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Download, Eye, ChevronLeft, ChevronRight, Image, Calendar } from "lucide-react";
import type { Camera as CameraType, Capture } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function CameraGalleryPage() {
  const params = useParams();
  const cameraId = params.id;
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { data: camera, isLoading: cameraLoading } = useQuery<CameraType>({
    queryKey: ["/api/admin/cameras", cameraId],
  });

  const captureQueryKey = `/api/admin/cameras/${cameraId}/captures${dateStart || dateEnd ? `?${new URLSearchParams({
    ...(dateStart && { dataInicio: dateStart }),
    ...(dateEnd && { dataFim: dateEnd }),
  }).toString()}` : ''}`;

  const { data: captures, isLoading: capturesLoading } = useQuery<Capture[]>({
    queryKey: [captureQueryKey],
  });

  const handlePrevious = () => {
    if (!captures || currentIndex <= 0) return;
    setCurrentIndex(currentIndex - 1);
    setSelectedCapture(captures[currentIndex - 1]);
  };

  const handleNext = () => {
    if (!captures || currentIndex >= captures.length - 1) return;
    setCurrentIndex(currentIndex + 1);
    setSelectedCapture(captures[currentIndex + 1]);
  };

  const openLightbox = (capture: Capture, index: number) => {
    setSelectedCapture(capture);
    setCurrentIndex(index);
  };

  if (cameraLoading) {
    return (
      <AdminLayout
        breadcrumbs={[
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Câmeras", href: "/admin/cameras" },
          { label: "Galeria" },
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
        { label: "Galeria" },
      ]}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" asChild data-testid="button-back">
              <Link href="/admin/cameras">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Galeria - {camera?.nome}</h1>
              <p className="text-sm text-muted-foreground">
                {captures?.length || 0} capturas disponíveis
              </p>
            </div>
          </div>
          <Button variant="outline" asChild data-testid="button-view-live">
            <Link href={`/admin/cameras/${cameraId}/live`}>
              <Eye className="mr-2 h-4 w-4" />
              Ver Ao Vivo
            </Link>
          </Button>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtrar por data:</span>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label htmlFor="dateStart" className="text-xs">
                  Data Início
                </Label>
                <Input
                  id="dateStart"
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="w-40"
                  data-testid="input-filter-date-start"
                />
              </div>
              <div>
                <Label htmlFor="dateEnd" className="text-xs">
                  Data Fim
                </Label>
                <Input
                  id="dateEnd"
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="w-40"
                  data-testid="input-filter-date-end"
                />
              </div>
              {(dateStart || dateEnd) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateStart("");
                    setDateEnd("");
                  }}
                  data-testid="button-clear-filters"
                >
                  Limpar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {capturesLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-lg" />
            ))}
          </div>
        ) : !captures || captures.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Image className="h-16 w-16 text-muted-foreground/30" />
              <p className="mt-4 text-lg font-medium">Nenhuma captura encontrada</p>
              <p className="text-sm text-muted-foreground">
                Tente ajustar os filtros de data
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {captures.map((capture, index) => (
              <Card
                key={capture.id}
                className="group cursor-pointer overflow-hidden hover-elevate"
                onClick={() => openLightbox(capture, index)}
                data-testid={`capture-${capture.id}`}
              >
                <div className="relative aspect-video">
                  <img
                    src={capture.imagemUrl}
                    alt={`Captura ${index + 1}`}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="text-xs text-white">
                      {capture.capturadoEm
                        ? format(new Date(capture.capturadoEm), "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })
                        : ""}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selectedCapture} onOpenChange={() => setSelectedCapture(null)}>
        <DialogContent className="max-w-4xl p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center justify-between">
              <span>
                Captura -{" "}
                {selectedCapture?.capturadoEm
                  ? format(new Date(selectedCapture.capturadoEm), "dd/MM/yyyy HH:mm:ss", {
                      locale: ptBR,
                    })
                  : ""}
              </span>
              {selectedCapture?.imagemUrl && (
                <Button variant="outline" size="sm" asChild data-testid="button-download-capture">
                  <a href={selectedCapture.imagemUrl} download>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </a>
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            <img
              src={selectedCapture?.imagemUrl}
              alt="Captura em tela cheia"
              className="w-full"
            />
            {captures && captures.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-4 top-1/2 -translate-y-1/2"
                  onClick={handlePrevious}
                  disabled={currentIndex <= 0}
                  data-testid="button-prev-capture"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  onClick={handleNext}
                  disabled={currentIndex >= captures.length - 1}
                  data-testid="button-next-capture"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 pb-4">
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} de {captures?.length || 0}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
