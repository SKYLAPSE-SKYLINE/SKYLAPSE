import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AdminLayout } from "@/components/admin-layout";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Video, Play, Download, Trash2, Film } from "lucide-react";
import type { Camera, Timelapse, TimelapseWithCamera } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const timelapseFormSchema = z.object({
  cameraId: z.string().min(1, "Selecione uma câmera"),
  nome: z.string().optional(),
  dataInicio: z.string().min(1, "Data de início é obrigatória"),
  dataFim: z.string().min(1, "Data de fim é obrigatória"),
  fps: z.coerce.number().default(30),
});

type TimelapseFormValues = z.infer<typeof timelapseFormSchema>;

export default function TimelapsesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: timelapses, isLoading } = useQuery<TimelapseWithCamera[]>({
    queryKey: ["/api/admin/timelapses"],
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.some((t) => t.status === "na_fila" || t.status === "processando");
      return hasProcessing ? 3000 : false;
    },
  });

  const { data: cameras } = useQuery<Camera[]>({
    queryKey: ["/api/admin/cameras"],
  });

  const form = useForm<TimelapseFormValues>({
    resolver: zodResolver(timelapseFormSchema),
    defaultValues: {
      cameraId: "",
      nome: "",
      dataInicio: "",
      dataFim: "",
      fps: 30,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TimelapseFormValues) => {
      return apiRequest("POST", "/api/admin/timelapses", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/timelapses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Time-lapse solicitado com sucesso!" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Erro ao solicitar time-lapse", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/timelapses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/timelapses"] });
      toast({ title: "Time-lapse removido com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao remover time-lapse", variant: "destructive" });
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    form.reset();
  };

  const onSubmit = (data: TimelapseFormValues) => {
    createMutation.mutate(data);
  };

  const columns = [
    {
      key: "nome",
      header: "Time-lapse",
      cell: (timelapse: TimelapseWithCamera) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <Film className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium">
              {timelapse.nome || `Timelapse #${timelapse.id.slice(0, 8)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {timelapse.camera?.nome || "Câmera desconhecida"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "periodo",
      header: "Período",
      cell: (timelapse: TimelapseWithCamera) => (
        <span className="text-sm">
          {timelapse.dataInicio} a {timelapse.dataFim}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (timelapse: TimelapseWithCamera) => {
        if (timelapse.status === "processando" && timelapse.progresso > 0) {
          return (
            <div className="w-32 space-y-1">
              <Progress value={timelapse.progresso} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {timelapse.progresso}%
              </p>
            </div>
          );
        }
        return <StatusBadge status={timelapse.status as any} />;
      },
    },
    {
      key: "fps",
      header: "FPS",
      cell: (timelapse: TimelapseWithCamera) => `${timelapse.fps} fps`,
    },
    {
      key: "createdAt",
      header: "Solicitado",
      cell: (timelapse: TimelapseWithCamera) =>
        timelapse.createdAt
          ? formatDistanceToNow(new Date(timelapse.createdAt), {
              addSuffix: true,
              locale: ptBR,
            })
          : "-",
    },
    {
      key: "actions",
      header: "",
      className: "w-28",
      cell: (timelapse: TimelapseWithCamera) => (
        <div className="flex items-center gap-1">
          {timelapse.status === "pronto" && timelapse.videoUrl && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setVideoUrl(timelapse.videoUrl)}
                data-testid={`button-play-timelapse-${timelapse.id}`}
              >
                <Play className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                asChild
                data-testid={`button-download-timelapse-${timelapse.id}`}
              >
                <a href={timelapse.videoUrl} download>
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Tem certeza que deseja remover este time-lapse?")) {
                deleteMutation.mutate(timelapse.id);
              }
            }}
            data-testid={`button-delete-timelapse-${timelapse.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout title="Time-lapses">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-300">
            Gere e gerencie videos time-lapse
          </p>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-timelapse">
                <Plus className="mr-2 h-4 w-4" />
                Novo Time-lapse
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gerar Time-lapse</DialogTitle>
                <DialogDescription>
                  Selecione a câmera e o período para gerar o vídeo
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="cameraId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Câmera</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-timelapse-camera">
                              <SelectValue placeholder="Selecione uma câmera" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {cameras?.map((camera) => (
                              <SelectItem key={camera.id} value={camera.id}>
                                {camera.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nome"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome (opcional)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex: Obra Janeiro 2024"
                            {...field}
                            data-testid="input-timelapse-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="dataInicio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data Início</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              {...field}
                              data-testid="input-timelapse-start"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dataFim"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data Fim</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              {...field}
                              data-testid="input-timelapse-end"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="fps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>FPS (Frames por segundo)</FormLabel>
                        <Select
                          onValueChange={(val) => field.onChange(Number(val))}
                          value={String(field.value)}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-timelapse-fps">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="15">15 fps (mais lento)</SelectItem>
                            <SelectItem value="30">30 fps (normal)</SelectItem>
                            <SelectItem value="60">60 fps (mais rápido)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={handleCloseDialog}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      data-testid="button-generate-timelapse"
                    >
                      <Video className="mr-2 h-4 w-4" />
                      {createMutation.isPending ? "Solicitando..." : "Gerar Time-lapse"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <DataTable
          columns={columns}
          data={timelapses || []}
          isLoading={isLoading}
          emptyMessage="Nenhum time-lapse gerado ainda"
          getRowTestId={(timelapse) => `row-timelapse-${timelapse.id}`}
        />
      </div>

      <Dialog open={!!videoUrl} onOpenChange={() => setVideoUrl(null)}>
        <DialogContent className="max-w-4xl p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Time-lapse</DialogTitle>
          </DialogHeader>
          <div className="bg-black">
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                autoPlay
                className="w-full max-h-[70vh]"
              />
            )}
          </div>
          <div className="flex justify-center pb-4">
            <Button variant="outline" size="sm" asChild>
              <a href={videoUrl || ""} download>
                <Download className="h-4 w-4 mr-1" />
                Baixar vídeo
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
