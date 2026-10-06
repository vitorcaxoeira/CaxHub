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
    // overflow-x-auto + shrink-0: com muitas abas (Eficiência tem 6) a linha rola em vez de estourar a página no celular.
    <div className="mb-6 flex gap-6 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const ativa = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              ativa ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
