import { ReactNode } from "react";

// Cartão das telas de acesso (login e aceitar convite): no topo, a logo completa do CaxHub sobre a
// cachoeira da imagem original; embaixo, o conteúdo de cada tela. A faixa é uma foto clara mesmo
// no tema escuro de propósito: a logo está sobre a própria foto e não depende do tema.
//
// A proporção 15:4 é a da faixa gerada por brand/gerar-marca.ps1 (login-faixa.jpg); fixa aqui
// para a faixa não "pular" de altura enquanto a imagem carrega. Era 3:2 e ficou alta demais
// (02/10/2026): o Vitor pediu 60% a menos de altura.
export function CartaoAcesso({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <img
          src="/marca/login-faixa.jpg"
          alt="CaxHub, o seu Hub de soluções"
          className="block aspect-[15/4] w-full border-b border-border object-cover"
        />
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}
