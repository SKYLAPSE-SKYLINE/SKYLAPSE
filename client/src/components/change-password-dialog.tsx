import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const schema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha atual"),
  novaSenha: z.string().min(8, "Nova senha deve ter pelo menos 8 caracteres"),
  confirmarSenha: z.string().min(1, "Confirme a nova senha"),
}).refine((d) => d.novaSenha === d.confirmarSenha, {
  message: "As senhas não coincidem",
  path: ["confirmarSenha"],
});

type FormValues = z.infer<typeof schema>;

interface ChangePasswordDialogProps {
  open: boolean;
  onSuccess: () => void;
  forceChange?: boolean; // true = primeiro acesso, não pode fechar
}

export function ChangePasswordDialog({ open, onSuccess, forceChange = false }: ChangePasswordDialogProps) {
  const { toast } = useToast();
  const [showAtual, setShowAtual] = useState(false);
  const [showNova, setShowNova] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { senhaAtual: "", novaSenha: "", confirmarSenha: "" },
  });

  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      apiRequest("POST", "/api/client/change-password", {
        senhaAtual: data.senhaAtual,
        novaSenha: data.novaSenha,
      }),
    onSuccess: () => {
      toast({ title: "Senha alterada com sucesso!", description: "Sua nova senha já está ativa." });
      onSuccess();
    },
    onError: (err: any) => {
      const msg = err?.message || "Erro ao alterar senha";
      if (msg.includes("atual")) {
        form.setError("senhaAtual", { message: "Senha atual incorreta" });
      } else {
        toast({ title: "Erro", description: msg, variant: "destructive" });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={forceChange ? undefined : () => {}}>
      <DialogContent
        className="bg-zinc-900 border border-zinc-700/50 shadow-2xl max-w-md p-0 overflow-hidden"
        onPointerDownOutside={forceChange ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={forceChange ? (e) => e.preventDefault() : undefined}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">
                {forceChange ? "Defina sua senha" : "Alterar senha"}
              </h2>
              <p className="text-blue-100 text-xs">
                {forceChange
                  ? "Por segurança, crie uma senha pessoal antes de continuar."
                  : "Escolha uma senha forte para sua conta."}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 py-5">
          {forceChange && (
            <div className="flex items-start gap-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 mb-5">
              <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300 leading-relaxed">
                Você está usando a senha temporária criada pelo administrador. Crie uma senha pessoal para continuar.
              </p>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
              <FormField
                control={form.control}
                name="senhaAtual"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300 text-sm">
                      {forceChange ? "Senha temporária" : "Senha atual"}
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showAtual ? "text" : "password"}
                          placeholder="••••••••"
                          className="bg-zinc-800 border-zinc-700 text-white pr-10"
                        />
                        <button type="button" onClick={() => setShowAtual(!showAtual)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200">
                          {showAtual ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="novaSenha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300 text-sm">Nova senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showNova ? "text" : "password"}
                          placeholder="Mínimo 8 caracteres"
                          className="bg-zinc-800 border-zinc-700 text-white pr-10"
                        />
                        <button type="button" onClick={() => setShowNova(!showNova)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200">
                          {showNova ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmarSenha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300 text-sm">Confirmar nova senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showConfirmar ? "text" : "password"}
                          placeholder="Repita a nova senha"
                          className="bg-zinc-800 border-zinc-700 text-white pr-10"
                        />
                        <button type="button" onClick={() => setShowConfirmar(!showConfirmar)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200">
                          {showConfirmar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold mt-2"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Salvando..." : "Salvar nova senha"}
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
