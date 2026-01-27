import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <Card className="mx-4 w-full max-w-md">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold" data-testid="text-404-title">
              404 - Página não encontrada
            </h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground" data-testid="text-404-message">
            A página que você procura não existe ou foi movida.
          </p>

          <div className="mt-6">
            <Button asChild data-testid="button-go-home">
              <Link href="/">
                <Home className="mr-2 h-4 w-4" />
                Voltar ao início
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
