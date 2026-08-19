// Kill switch temporário: enquanto true, nenhuma chamada de rede para o
// repositório de dados (raw.githubusercontent.com) é executada. Usado durante
// processos de atualização/manutenção dos dados. Reverter para false (ou
// remover as chamadas a assertServiceEnabled) restaura o funcionamento normal.
export const SERVICE_DISABLED = true;

export function assertServiceEnabled() {
  if (SERVICE_DISABLED) {
    throw new Error(
      "Serviço temporariamente desativado devido a processos de atualização dos dados."
    );
  }
}
