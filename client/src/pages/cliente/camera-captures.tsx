import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Calendar, ChevronLeft, ChevronRight, Image } from "lucide-react";
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
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Capture } from "@shared/schema";

type ClientCamera = {
  id: string;
  nome: string;
  localidade: { nome: string } | null;
};

export default function ClienteCameraCaptures() {
  const params = useParams();
  const cameraId = params.id as string;

  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { data: cameras } = useQuery<ClientCamera[]>({
    queryKey: ["/api/client/cameras"],
  });

  const camera = cameras?.find((c) => c.id === cameraId);

  const captureQueryKey = `/api/client/cameras/${cameraId}/captures${
    dateStart || dateEnd
      ? `?${new URLSearchParams({
          ...(dateStart && { dataInicio: dateStart }),
          ...(dateEnd && { dataFim: dateEnd }),
        }).toString()}`
      : ""
  }`;

  const { data: captures, isLoading: capturesLoading } = useQuery<Capture[]>({
    queryKey: [captureQueryKey],
  });

  const handlePrevious = () => {
    if (!captures || currentIndex <= 0) return;
    const newIdx = currentIndex - 1;
    setCurrentIndex(newIdx);
    setSelectedCapture(captures[newIdx]);
  };

  const handleNext = () => {
    if (!captures || currentIndex >= captures.length - 1) return;
    const newIdx = currentIndex + 1;
    setCurrentIndex(newIdx);
    setSelectedCapture(captures[newIdx]);
  };

  const openLightbox = (capture: Capture, index: number) => {
    setSelectedCapture(capture);
    setCurrentIndex(index);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Camera className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight">SKYLAPSE</span>
            <p className="text-xs text-muted-foreground leading-none">Portal do Cliente</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/cliente/dashboard" data-testid="button-back-to-dashboard">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
      </header>

      <main className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-gallery-title">
            {camera ? `Galeria — ${camera.nome}` : "Galeria de Capturas"}
          </h1>
          {camera?.localidade && (
            <p className="text-muted-foreground text-sm mt-1">{camera.localidade.nome}</p>
          )}
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtrar por data:</span>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label htmlFor="dateStart" className="text-xs">Data Início</Label>
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
                <Label htmlFor="dateEnd" className="text-xs">Data Fim</Label>
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
                  onClick={() => { setDateStart(""); setDateEnd(""); }}
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
                {dateStart || dateEnd
                  ? "Tente ajustar os filtros de data"
                  : "Ainda não há capturas para esta câmera"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" data-testid="text-captures-count">
              {captures.length} captura{captures.length !== 1 ? "s" : ""} encontrada{captures.length !== 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {captures.map((capture, index) => (
                <Card
                  key={capture.id}
                  className="group cursor-pointer overflow-hidden"
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
                          ? format(new Date(capture.capturadoEm), "dd/MM/yyyy HH:mm", { locale: ptBR })
                          : ""}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>

      <Dialog open={!!selectedCapture} onOpenChange={() => setSelectedCapture(null)}>
        <DialogContent className="max-w-4xl p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              Captura —{" "}
              {selectedCapture?.capturadoEm
                ? format(new Date(selectedCapture.capturadoEm), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="relative bg-black">
            <img
              src={selectedCapture?.imagemUrl}
              alt="Captura em tela cheia"
              className="w-full object-contain max-h-[70vh]"
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
          <div className="flex items-center justify-center gap-2 pb-4 pt-2">
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} de {captures?.length || 0}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
