export interface TabDef {
  key: string;
  label: string;
}

interface TabsProps {
  tabs: TabDef[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, activeKey, onChange }: TabsProps) {
  return (
    // Duas camadas de propósito. A de fora só tem a linha (border-b). A de dentro rola na horizontal quando há muitas abas
    // (Eficiência tem 7) em vez de estourar a página no celular, e `-mb-px` faz o sublinhado da aba ativa cobrir a linha.
    // `overflow-x-auto` NÃO pode ficar na mesma caixa dos botões com `-mb-px`: no CSS, se um eixo não é `visible` o outro
    // também vira rolável, e o pixel que o sublinhado sobra para baixo da caixa virava uma barra de rolagem VERTICAL
    // (visível no Windows, escondida em screenshot sem interface). Aqui o sublinhado fica dentro da caixa que rola.
    <div className="mb-6 border-b border-border">
      <div className="-mb-px flex gap-6 overflow-x-auto">
        {tabs.map((tab) => {
          const ativa = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition ${
                ativa ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
