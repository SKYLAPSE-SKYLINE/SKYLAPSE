import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Camera, Video, Clock, Shield, Zap, Globe } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
              <Camera className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">SKYLAPSE</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button asChild data-testid="button-login">
              <a href="/api/login">Entrar</a>
            </Button>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        <section className="relative overflow-hidden py-20 sm:py-32">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-primary/10" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="font-serif text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Monitoramento de Câmeras
                <span className="block text-primary">com Time-lapses</span>
              </h1>
              <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
                Plataforma SaaS completa para monitoramento de câmeras IP distribuídas em múltiplas localidades, 
                com captura automática de fotos e geração de time-lapses sob demanda.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button size="lg" asChild data-testid="button-get-started">
                  <a href="/api/login">Começar Agora</a>
                </Button>
                <Button size="lg" variant="outline" data-testid="button-learn-more">
                  Saiba Mais
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-green-500" />
                  Seguro e Confiável
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Setup Rápido
                </span>
                <span className="flex items-center gap-1.5">
                  <Globe className="h-4 w-4 text-blue-500" />
                  Acesso em Qualquer Lugar
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Recursos Principais
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Tudo que você precisa para monitorar suas câmeras de forma profissional
              </p>
            </div>
            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <Card className="hover-elevate">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Camera className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Multi-Câmeras</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Suporte a Reolink, Intelbras, Hikvision e outras marcas populares de câmeras IP.
                  </p>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                    <Clock className="h-7 w-7 text-green-500" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Captura Automática</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Capturas programadas a cada 5, 10, 15 ou 30 minutos. 100% automatizado e confiável.
                  </p>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
                    <Video className="h-7 w-7 text-amber-500" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Time-lapses</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Gere vídeos time-lapse impressionantes a partir das capturas. Perfeito para obras e eventos.
                  </p>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/10">
                    <Globe className="h-7 w-7 text-purple-500" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Multi-localidades</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Organize câmeras por localidade. Perfeito para empresas com múltiplos sites.
                  </p>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10">
                    <Shield className="h-7 w-7 text-blue-500" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Multi-tenant</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cada cliente vê apenas suas câmeras. Segurança e privacidade garantidas.
                  </p>
                </CardContent>
              </Card>

              <Card className="hover-elevate">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
                    <Zap className="h-7 w-7 text-red-500" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Visualização ao Vivo</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Acompanhe suas câmeras em tempo real com snapshots atualizados automaticamente.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/30 py-20 sm:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Pronto para começar?
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Comece a monitorar suas câmeras hoje mesmo com nossa plataforma profissional.
              </p>
              <div className="mt-10">
                <Button size="lg" asChild data-testid="button-cta-login">
                  <a href="/api/login">Entrar na Plataforma</a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <span className="font-semibold">SKYLAPSE</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} SKYLAPSE. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
