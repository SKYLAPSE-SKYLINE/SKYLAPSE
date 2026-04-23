import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Download, FileArchive, Camera, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fmtShort, fmtLong, fmtFilename } from "@/lib/date";
import type { Capture } from "@shared/schema";

type ClientCamera = {
  id: string;
  nome: string;
  localidade: { nome: string } | null;
};

const ITEMS_PER_PAGE = 50;

export default function ClienteCameraCaptures() {
  const params = useParams();
  const cameraId = params.id as string;

  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [page, setPage] = useState(1);
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { data: cameras } = useQuery<ClientCamera[]>({
    queryKey: ["/api/client/cameras"],
  });

  const camera = cameras?.find((c) => c.id === cameraId);

  const captureQueryKey = `/api/client/cameras/${cameraId}/captures?${new URLSearchParams({
    ...(dateStart && { dataInicio: dateStart }),
    ...(dateEnd && { dataFim: dateEnd }),
    page: String(page),
    limit: String(ITEMS_PER_PAGE),
  }).toString()}`;

  const { data: captureResult, isLoading: capturesLoading } = useQuery<{ data: Capture[]; total: number }>({
    queryKey: [captureQueryKey],
  });

  const captures = captureResult?.data;
  const totalCaptures = captureResult?.total ?? 0;
  const totalPages = Math.ceil(totalCaptures / ITEMS_PER_PAGE);

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
    <div className="min-h-screen bg-zinc-950 dark">
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800/50">
        <div className="mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/cliente/dashboard"
              className="text-zinc-500 hover:text-white transition-colors"
              data-testid="button-back-to-dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="h-5 w-px bg-zinc-800" />
            <div>
              <h1 className="text-sm font-medium text-white leading-none" data-testid="text-gallery-title">
                {camera?.nome || "Galeria"}
              </h1>
              {camera?.localidade && (
                <p className="text-xs text-zinc-500 mt-0.5">{camera.localidade.nome}</p>
              )}
            </div>
          </div>
          <Link href="/cliente/dashboard" className="text-lg font-bold text-white tracking-tight">
            Sky<span className="text-blue-400">Lapse</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto px-6 lg:px-10 py-6 space-y-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800/50 rounded-lg px-3 py-2">
            <Calendar className="h-3.5 w-3.5 text-zinc-500" />
            <Input
              type="date"
              value={dateStart}
              onChange={(e) => { setDateStart(e.target.value); setPage(1); }}
              className="h-auto p-0 border-0 bg-transparent text-xs text-white w-32 focus-visible:ring-0"
              placeholder="Data inicio"
              data-testid="input-filter-date-start"
            />
            <span className="text-zinc-600 text-xs">—</span>
            <Input
              type="date"
              value={dateEnd}
              onChange={(e) => { setDateEnd(e.target.value); setPage(1); }}
              className="h-auto p-0 border-0 bg-transparent text-xs text-white w-32 focus-visible:ring-0"
              placeholder="Data fim"
              data-testid="input-filter-date-end"
            />
            {(dateStart || dateEnd) && (
              <button
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={() => { setDateStart(""); setDateEnd(""); setPage(1); }}
                data-testid="button-clear-filters"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-zinc-500" data-testid="text-captures-count">
              {totalCaptures} captura{totalCaptures !== 1 ? "s" : ""}
            </span>
            {dateStart && dateEnd && totalCaptures > 0 && (
              <a
                href={`/api/client/cameras/${cameraId}/captures/download?dataInicio=${dateStart}&dataFim=${dateEnd}`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors"
              >
                <FileArchive className="h-3.5 w-3.5" />
                ZIP ({totalCaptures})
              </a>
            )}
          </div>
        </div>

        {/* Grid */}
        {capturesLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[...Array(15)].map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-lg bg-zinc-800" />
            ))}
          </div>
        ) : !captures || captures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
              <Camera className="h-7 w-7 text-zinc-600" />
            </div>
            <p className="text-white font-medium">Nenhuma captura encontrada</p>
            <p className="text-sm text-zinc-600 mt-1">
              {dateStart || dateEnd
                ? "Tente ajustar os filtros de data"
                : "Ainda nao ha capturas para esta camera"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {captures.map((capture, index) => (
                <div
                  key={capture.id}
                  className="group relative aspect-video rounded-lg overflow-hidden bg-zinc-800 cursor-pointer"
                  onClick={() => openLightbox(capture, index)}
                  data-testid={`capture-${capture.id}`}
                >
                  <img
                    src={capture.imagemUrl}
                    alt={`Captura ${(page - 1) * ITEMS_PER_PAGE + index + 1}`}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  {/* Bottom info on hover */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="absolute bottom-0 left-0 right-0 p-2 flex items-end justify-between">
                      <span className="text-[11px] text-white/80">
                        {capture.capturadoEm
                          ? fmtShort(capture.capturadoEm)
                          : ""}
                      </span>
                      <ZoomIn className="h-3.5 w-3.5 text-white/60" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-xs font-medium hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </button>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-xs font-medium hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                  Proxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Lightbox */}
      <Dialog open={!!selectedCapture} onOpenChange={() => setSelectedCapture(null)}>
        <DialogContent className="max-w-5xl p-0 bg-black border-zinc-800 gap-0 overflow-hidden">
          {/* Image */}
          <div className="relative bg-black">
            <img
              src={selectedCapture?.imagemUrl}
              alt="Captura"
              className="w-full object-contain max-h-[80vh]"
            />
            {/* Nav arrows */}
            {captures && captures.length > 1 && (
              <>
                <button
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/70 disabled:opacity-20 transition-all"
                  onClick={handlePrevious}
                  disabled={currentIndex <= 0}
                  data-testid="button-prev-capture"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/70 disabled:opacity-20 transition-all"
                  onClick={handleNext}
                  disabled={currentIndex >= captures.length - 1}
                  data-testid="button-next-capture"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/50">
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 tabular-nums">
                {currentIndex + 1} / {captures?.length || 0}
              </span>
              <span className="text-xs text-zinc-400">
                {selectedCapture?.capturadoEm
                  ? fmtLong(selectedCapture.capturadoEm)
                  : ""}
              </span>
            </div>
            {selectedCapture && (
              <a
                href={selectedCapture.imagemUrl}
                download={`captura_${selectedCapture.capturadoEm ? fmtFilename(selectedCapture.capturadoEm) : selectedCapture.id}.jpg`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
