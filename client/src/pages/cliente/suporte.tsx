import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Plus, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Ticket = {
  id: string;
  assunto: string;
  categoria: string;
  prioridade: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  ticketId: string;
  autorTipo: "cliente" | "admin";
  autorNome: string;
  mensagem: string;
  createdAt: string;
};

type TicketDetail = Ticket & { messages: Message[] };

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  aberto: { label: "Aberto", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  em_andamento: { label: "Em andamento", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  resolvido: { label: "Resolvido", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  fechado: { label: "Fechado", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const CATEGORIA_LABEL: Record<string, string> = {
  camera: "Câmera",
  conta: "Conta",
  duvida: "Dúvida",
  outro: "Outro",
};

const PRIORIDADE_LABEL: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

export default function ClienteSuporte() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: tickets, isLoading } = useQuery<Ticket[]>({
    queryKey: ["/api/client/tickets"],
  });

  return (
    <div className="min-h-screen bg-zinc-950 dark">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800/50">
        <div className="mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/cliente/dashboard" className="text-zinc-500 hover:text-white transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="text-lg font-bold text-white tracking-tight">
              Sky<span className="text-blue-400">Lapse</span>
            </span>
            <span className="text-sm text-zinc-400">Suporte</span>
          </div>
          <Button
            size="sm"
            onClick={() => setNewOpen(true)}
            className="bg-blue-600 hover:bg-blue-500"
            data-testid="button-new-ticket"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Nova solicitação
          </Button>
        </div>
      </header>

      <main className="mx-auto px-6 lg:px-10 py-8 max-w-5xl animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Minhas solicitações</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Dúvidas, problemas ou pedidos — registre aqui para que a equipe SkyLapse te ajude.
          </p>
        </div>

        {isLoading ? (
          <div className="text-zinc-500 text-sm">Carregando...</div>
        ) : !tickets || tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
              <MessageSquare className="h-7 w-7 text-zinc-600" />
            </div>
            <p className="text-white font-medium">Nenhuma solicitação ainda</p>
            <p className="text-sm text-zinc-600 mt-1">Crie sua primeira solicitação quando precisar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="w-full text-left rounded-xl bg-zinc-900 border border-zinc-800/50 hover:border-zinc-700 transition-colors p-4"
                data-testid={`ticket-item-${t.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{t.assunto}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                        {CATEGORIA_LABEL[t.categoria] || t.categoria}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_LABEL[t.status]?.color || "border-zinc-700 text-zinc-400"}`}>
                        {STATUS_LABEL[t.status]?.label || t.status}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 shrink-0">
                    {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <NewTicketDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <TicketDetailDialog
        ticketId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [assunto, setAssunto] = useState("");
  const [categoria, setCategoria] = useState("duvida");
  const [prioridade, setPrioridade] = useState("media");
  const [mensagem, setMensagem] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/client/tickets", { assunto, categoria, prioridade, mensagem }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client/tickets"] });
      toast({ title: "Solicitação criada", description: "Nossa equipe foi notificada." });
      setAssunto(""); setMensagem(""); setCategoria("duvida"); setPrioridade("media");
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-white">Nova solicitação</DialogTitle>
          <DialogDescription>Descreva a sua dúvida ou problema. Vamos responder o quanto antes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">Assunto</label>
            <Input
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              placeholder="Ex: Câmera X parou de gravar"
              data-testid="input-assunto"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Categoria</label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger data-testid="select-categoria"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="camera">Câmera</SelectItem>
                  <SelectItem value="conta">Conta</SelectItem>
                  <SelectItem value="duvida">Dúvida</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Prioridade</label>
              <Select value={prioridade} onValueChange={setPrioridade}>
                <SelectTrigger data-testid="select-prioridade"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">Mensagem</label>
            <Textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={5}
              placeholder="Conte o que está acontecendo com detalhes..."
              data-testid="textarea-mensagem"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || assunto.length < 3 || mensagem.length < 1}
            className="bg-blue-600 hover:bg-blue-500"
            data-testid="button-submit-ticket"
          >
            {createMutation.isPending ? "Enviando..." : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketDetailDialog({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");

  const { data: ticket, isLoading } = useQuery<TicketDetail>({
    queryKey: ["/api/client/tickets", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/client/tickets/${ticketId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!ticketId,
    refetchInterval: ticketId ? 15_000 : false,
  });

  const replyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/client/tickets/${ticketId}/messages`, { mensagem: reply }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client/tickets", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/client/tickets"] });
      setReply("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const isClosed = ticket?.status === "fechado";

  return (
    <Dialog open={!!ticketId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-zinc-800">
        {isLoading || !ticket ? (
          <div className="text-zinc-500 text-sm py-8 text-center">Carregando...</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-white">{ticket.assunto}</DialogTitle>
              <div className="flex gap-2 pt-1">
                <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                  {CATEGORIA_LABEL[ticket.categoria] || ticket.categoria}
                </Badge>
                <Badge variant="outline" className={`text-[10px] ${STATUS_LABEL[ticket.status]?.color}`}>
                  {STATUS_LABEL[ticket.status]?.label || ticket.status}
                </Badge>
                <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                  Prioridade: {PRIORIDADE_LABEL[ticket.prioridade] || ticket.prioridade}
                </Badge>
              </div>
            </DialogHeader>

            <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-2">
              {ticket.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg p-3 ${
                    m.autorTipo === "cliente"
                      ? "bg-blue-600/10 border border-blue-600/20 ml-8"
                      : "bg-zinc-900 border border-zinc-800 mr-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-white">
                      {m.autorNome} {m.autorTipo === "admin" && <span className="text-blue-400">(SkyLapse)</span>}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{m.mensagem}</p>
                </div>
              ))}
            </div>

            {isClosed ? (
              <p className="text-xs text-zinc-500 italic text-center py-2">Este ticket está fechado.</p>
            ) : (
              <div className="flex gap-2 pt-2 border-t border-zinc-800">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Responder..."
                  className="flex-1"
                  data-testid="textarea-reply"
                />
                <Button
                  onClick={() => replyMutation.mutate()}
                  disabled={replyMutation.isPending || reply.length < 1}
                  className="bg-blue-600 hover:bg-blue-500 self-end"
                  data-testid="button-send-reply"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
