import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Camera, 
  Eye, 
  Image, 
  TestTube2,
  CheckCircle,
  XCircle,
  Loader2,
  Wifi,
} from "lucide-react";
import type { Camera as CameraType, Location, CameraWithLocation } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const cameraFormSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  localidadeId: z.string().min(1, "Selecione uma localidade"),
  marca: z.enum(["reolink", "intelbras", "hikvision", "outra"]),
  modelo: z.string().optional(),
  streamUrl: z.string().optional(),
  hostname: z.string().optional(),
  portaHttp: z.coerce.number().min(1).max(65535).optional().or(z.literal(0)),
  portaRtsp: z.coerce.number().min(1).max(65535).optional().nullable(),
  usuario: z.string().optional(),
  senha: z.string().optional(),
  intervaloCaptura: z.coerce.number().default(15),
}).superRefine((data, ctx) => {
  const hasStream = data.streamUrl && data.streamUrl.trim().length > 0;
  if (!hasStream) {
    if (!data.hostname || data.hostname.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "Hostname é obrigatório sem URL de Stream", path: ["hostname"] });
    }
    if (!data.portaHttp || data.portaHttp < 1) {
      ctx.addIssue({ code: "custom", message: "Porta HTTP é obrigatória sem URL de Stream", path: ["portaHttp"] });
    }
    if (!data.usuario || data.usuario.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "Usuário é obrigatório sem URL de Stream", path: ["usuario"] });
    }
    if (!data.senha || data.senha.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "Senha é obrigatória sem URL de Stream", path: ["senha"] });
    }
  }
});

type CameraFormValues = z.infer<typeof cameraFormSchema>;

interface TestResult {
  sucesso: boolean;
  mensagem: string;
  imagem?: string;
}

function DeleteCameraDialog({
  camera,
  onConfirm,
  onCancel,
  isPending,
}: {
  camera: CameraWithLocation;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [typed, setTyped] = useState("");
  const expected = `DELETE ${camera.nome}`;
  const isValid = typed === expected;

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-500">
            <Trash2 className="h-5 w-5" />
            Remover câmera
          </DialogTitle>
          <DialogDescription className="pt-1">
            Esta ação é <strong>irreversível</strong>. Os registros de capturas no banco de dados serão apagados. Os arquivos de imagem no disco permanecem em{" "}
            <code className="bg-zinc-800 px-1 rounded text-xs">uploads/captures/{camera.id}/</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-zinc-400">
            Para confirmar, digite exatamente:
          </p>
          <code className="block bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-red-400 font-mono select-all">
            {expected}
          </code>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Digite: ${expected}`}
            className="font-mono text-sm"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && isValid) onConfirm(); }}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!isValid || isPending}
          >
            {isPending ? "Removendo..." : "Remover câmera"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CamerasPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CameraType | null>(null);
  const [cameraToDelete, setCameraToDelete] = useState<CameraWithLocation | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const { data: cameras, isLoading } = useQuery<CameraWithLocation[]>({
    queryKey: ["/api/admin/cameras"],
    refetchInterval: 60_000,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/admin/locations"],
  });

  const form = useForm<CameraFormValues>({
    resolver: zodResolver(cameraFormSchema),
    defaultValues: {
      nome: "",
      localidadeId: "",
      marca: "reolink",
      modelo: "",
      streamUrl: "",
      hostname: "",
      portaHttp: 80,
      portaRtsp: undefined,
      usuario: "admin",
      senha: "",
      intervaloCaptura: 15,
    },
  });

  const watchStreamUrl = form.watch("streamUrl");
  const hasStreamUrl = watchStreamUrl && watchStreamUrl.trim().length > 0;

  const createMutation = useMutation({
    mutationFn: async (data: CameraFormValues) => apiRequest("POST", "/api/admin/cameras", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Câmera adicionada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => toast({ title: "Erro ao adicionar câmera", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CameraFormValues & { id: string }) =>
      apiRequest("PUT", `/api/admin/cameras/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      toast({ title: "Câmera atualizada com sucesso!" });
      handleCloseDialog();
    },
    onError: () => toast({ title: "Erro ao atualizar câmera", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/cameras/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Câmera removida com sucesso!" });
      setCameraToDelete(null);
    },
    onError: () => toast({ title: "Erro ao remover câmera", variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async (data: Partial<CameraFormValues>) => {
      const response = await apiRequest("POST", "/api/admin/cameras/test", data);
      return response.json();
    },
    onSuccess: (data: TestResult) => setTestResult(data),
    onError: () => setTestResult({ sucesso: false, mensagem: "Erro ao testar conexão com a câmera" }),
  });

  const handleOpenDialog = (camera?: CameraType) => {
    setTestResult(null);
    if (camera) {
      setEditingCamera(camera);
      form.reset({
        nome: camera.nome,
        localidadeId: camera.localidadeId || "",
        marca: (camera.marca as "reolink" | "intelbras" | "hikvision" | "outra") || "reolink",
        modelo: camera.modelo || "",
        streamUrl: (camera as any).streamUrl || "",
        hostname: camera.hostname || "",
        portaHttp: camera.portaHttp || 80,
        portaRtsp: camera.portaRtsp ?? undefined,
        usuario: camera.usuario || "",
        senha: camera.senha || "",
        intervaloCaptura: camera.intervaloCaptura,
      });
    } else {
      setEditingCamera(null);
      form.reset({
        nome: "", localidadeId: "", marca: "reolink", modelo: "",
        streamUrl: "", hostname: "", portaHttp: 80, portaRtsp: undefined,
        usuario: "admin", senha: "", intervaloCaptura: 15,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingCamera(null);
    setTestResult(null);
    setShowPassword(false);
    form.reset();
  };

  const handleTestConnection = () => {
    const values = form.getValues();
    if (values.streamUrl && values.streamUrl.trim().length > 0) {
      testMutation.mutate({ streamUrl: values.streamUrl });
    } else {
      testMutation.mutate({
        hostname: values.hostname,
        portaHttp: values.portaHttp,
        usuario: values.usuario,
        senha: values.senha,
        marca: values.marca,
      });
    }
  };

  const onSubmit = (data: CameraFormValues) => {
    if (editingCamera) {
      updateMutation.mutate({ ...data, id: editingCamera.id });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <AdminLayout title="Cameras">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-300">{cameras?.length || 0} camera{(cameras?.length || 0) !== 1 ? "s" : ""} cadastrada{(cameras?.length || 0) !== 1 ? "s" : ""}</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button
                onClick={() => handleOpenDialog()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                data-testid="button-add-camera"
              >
                <Plus className="h-4 w-4" />Nova Camera
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{editingCamera ? "Editar Câmera" : "Adicionar Nova Câmera"}</DialogTitle>
                <DialogDescription>
                  {editingCamera ? "Atualize as configurações da câmera" : "Configure uma nova câmera para monitoramento"}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                  {/* Informações Básicas */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">Informações Básicas</h3>
                    <FormField control={form.control} name="nome" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome da Câmera</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Câmera Entrada Principal" {...field} data-testid="input-camera-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="localidadeId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Localidade</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-camera-location">
                              <SelectValue placeholder="Selecione uma localidade" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {locations?.map((location) => (
                              <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="marca" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marca</FormLabel>
                        <FormControl>
                          <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-wrap gap-4">
                            {["reolink", "intelbras", "hikvision", "outra"].map((marca) => (
                              <div key={marca} className="flex items-center space-x-2">
                                <RadioGroupItem value={marca} id={marca} />
                                <Label htmlFor={marca} className="capitalize">{marca}</Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="modelo" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Modelo (opcional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: RLC-811A" {...field} data-testid="input-camera-model" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <Separator />

                  {/* Stream via go2rtc */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Wifi className="h-4 w-4" />
                        Stream via go2rtc + Tailscale (opcional)
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Se preenchido, snapshots e stream ao vivo usarão o go2rtc. Os campos de rede abaixo tornam-se opcionais.
                      </p>
                    </div>
                    <FormField control={form.control} name="streamUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL do Stream (go2rtc)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://nome-do-dispositivo.taild2c22c.ts.net"
                            {...field}
                            data-testid="input-camera-stream-url"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {hasStreamUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => testMutation.mutate({ streamUrl: form.getValues("streamUrl") })}
                        disabled={testMutation.isPending}
                        data-testid="button-test-stream"
                      >
                        {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                        Testar Stream
                      </Button>
                    )}
                  </div>

                  <Separator />

                  {/* Configurações de Rede */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Configurações de Rede {hasStreamUrl && <span className="text-xs font-normal">(opcional quando usando go2rtc)</span>}
                    </h3>
                    <FormField control={form.control} name="hostname" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hostname / IP / NO-IP</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex: timelapse-sky.ddns.net"
                            {...field}
                            data-testid="input-camera-hostname"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Apenas o endereço, sem http:// ou porta.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="portaHttp" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Porta HTTP</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="80" {...field} data-testid="input-camera-port-http" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="portaRtsp" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Porta RTSP (opcional)</FormLabel>
                          <FormControl>
                            <Input
                              type="number" placeholder="554"
                              {...field} value={field.value ?? ""}
                              data-testid="input-camera-port-rtsp"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  {/* Credenciais */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Credenciais {hasStreamUrl && <span className="text-xs font-normal">(opcional quando usando go2rtc)</span>}
                    </h3>
                    <FormField control={form.control} name="usuario" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Usuário</FormLabel>
                        <FormControl>
                          <Input placeholder="admin" {...field} data-testid="input-camera-username" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="senha" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Senha</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••"
                              {...field}
                              data-testid="input-camera-password"
                            />
                            <Button type="button" variant="outline" size="icon" onClick={() => setShowPassword(!showPassword)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Captura Automática */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground">Captura Automática</h3>
                    <FormField control={form.control} name="intervaloCaptura" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Intervalo de Captura</FormLabel>
                        <Select onValueChange={(val) => field.onChange(Number(val))} value={String(field.value)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-camera-interval"><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="5">5 minutos</SelectItem>
                            <SelectItem value="10">10 minutos</SelectItem>
                            <SelectItem value="15">15 minutos</SelectItem>
                            <SelectItem value="30">30 minutos</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Testar Conexão */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleTestConnection}
                    disabled={testMutation.isPending}
                    data-testid="button-test-connection"
                  >
                    {testMutation.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <TestTube2 className="mr-2 h-4 w-4" />}
                    {hasStreamUrl ? "Testar Stream (go2rtc)" : "Testar Conexão"}
                  </Button>

                  {testResult && (
                    <Card className={testResult.sucesso ? "border-green-500" : "border-destructive"}>
                      <CardContent className="flex flex-col gap-3 p-4">
                        <div className="flex items-center gap-3">
                          {testResult.sucesso
                            ? <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                            : <XCircle className="h-5 w-5 text-destructive shrink-0" />}
                          <span className={testResult.sucesso ? "text-green-600" : "text-destructive"}>
                            {testResult.mensagem}
                          </span>
                        </div>
                        {testResult.imagem && (
                          <img src={testResult.imagem} alt="Snapshot de teste" className="rounded-md w-full object-cover max-h-48" />
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={handleCloseDialog}>Cancelar</Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-camera"
                    >
                      {createMutation.isPending || updateMutation.isPending ? "Salvando..." : "Salvar Câmera"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/50">
                <Skeleton className="aspect-[16/10] w-full bg-zinc-800" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-2/3 bg-zinc-800" />
                  <Skeleton className="h-3 w-1/3 bg-zinc-800" />
                </div>
              </div>
            ))}
          </div>
        ) : !cameras || cameras.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
              <Camera className="h-7 w-7 text-zinc-300" />
            </div>
            <p className="text-white font-medium">Nenhuma camera cadastrada</p>
            <p className="text-sm text-zinc-300 mt-1">Adicione sua primeira camera</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {cameras.map((cam) => (
              <div
                key={cam.id}
                className="group relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/50"
                data-testid={`row-camera-${cam.id}`}
              >
                {/* Thumbnail */}
                <div className="relative aspect-[16/10] bg-zinc-800 overflow-hidden">
                  <img
                    src={`/api/admin/cameras/${cam.id}/thumbnail`}
                    alt={cam.nome}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <Camera className="h-8 w-8 text-zinc-300 absolute inset-0 m-auto" />

                  {/* Status dot */}
                  <div className="absolute top-3 left-3">
                    <div className={`w-2.5 h-2.5 rounded-full border-2 border-black/40 ${
                      cam.status === "online"
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                        : "bg-zinc-500"
                    }`} />
                  </div>

                  {/* Hover actions */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-center pb-4 gap-2">
                    <Link
                      href={`/admin/cameras/${cam.id}/live`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-white/35 transition-colors shadow-sm"
                    >
                      <Eye className="h-3.5 w-3.5" /> Ao Vivo
                    </Link>
                    <Link
                      href={`/admin/cameras/${cam.id}/galeria`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-white/35 transition-colors shadow-sm"
                    >
                      <Image className="h-3.5 w-3.5" /> Galeria
                    </Link>
                    <button
                      onClick={() => handleOpenDialog(cam)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs hover:bg-white/35 transition-colors shadow-sm"
                      data-testid={`button-edit-camera-${cam.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setCameraToDelete(cam)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/20 backdrop-blur-sm text-red-200 text-xs hover:bg-red-500/40 transition-colors shadow-sm"
                      data-testid={`button-delete-camera-${cam.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Info */}
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-white truncate">{cam.nome}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-zinc-300 truncate">{cam.localidade?.nome || "Sem localidade"}</span>
                      <span className="text-xs text-zinc-300">·</span>
                      <span className="text-xs text-zinc-300 capitalize">{cam.marca}</span>
                      {(cam as any).streamUrl && (
                        <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                          <Wifi className="h-2.5 w-2.5" /> go2rtc
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-zinc-300">
                      {cam.ultimaCaptura
                        ? formatDistanceToNow(new Date(cam.ultimaCaptura), { addSuffix: true, locale: ptBR })
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cameraToDelete && (
        <DeleteCameraDialog
          camera={cameraToDelete}
          onConfirm={() => deleteMutation.mutate(cameraToDelete.id)}
          onCancel={() => setCameraToDelete(null)}
          isPending={deleteMutation.isPending}
        />
      )}
    </AdminLayout>
  );
}
