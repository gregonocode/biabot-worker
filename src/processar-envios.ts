import { supabase } from './supabase';
import { evolutionFetch } from './evolution';

type Agendamento = {
  id: string;
  user_id: string;
  campanha_id: string | null;
  midia_id: string | null;
  grupo_id: string;
  instancia_id: string | null;
  tipo_conteudo: string | null;
  conteudo_url: string | null;
  texto: string | null;
  tentativas: number | null;
};

type Grupo = {
  id: string;
  nome: string | null;
  group_jid: string;
};

type Instancia = {
  id: string;
  instance_name: string;
  status: string;
};

async function marcarComoErro(
  agendamento: Agendamento,
  erro: string,
) {
  const tentativas = (agendamento.tentativas ?? 0) + 1;

  await supabase
    .from('agendamentos_envio')
    .update({
      status: tentativas >= 3 ? 'erro' : 'pendente',
      tentativas,
      ultimo_erro: erro,
    })
    .eq('id', agendamento.id);

  await supabase.from('envios_logs').insert({
    user_id: agendamento.user_id,
    instancia_id: agendamento.instancia_id,
    grupo_id: agendamento.grupo_id,
    campanha_id: agendamento.campanha_id,
    midia_id: agendamento.midia_id,
    agendamento_id: agendamento.id,
    status: 'erro',
    mensagem: erro,
    erro,
  });
}

async function enviarTexto(
  instancia: Instancia,
  grupo: Grupo,
  texto: string,
) {
  return evolutionFetch('/message/sendText/' + instancia.instance_name, {
    method: 'POST',
    body: {
      number: grupo.group_jid,
      text: texto,
    },
  });
}

export async function processarEnvios() {
  const { data: agendamentos, error } = await supabase
    .from('agendamentos_envio')
    .select('*')
    .eq('status', 'pendente')
    .lte('enviar_em', new Date().toISOString())
    .order('enviar_em', { ascending: true })
    .limit(5);

  if (error) {
    console.error('Erro ao buscar agendamentos:', error);
    return;
  }

  if (!agendamentos || agendamentos.length === 0) {
    return;
  }

  for (const agendamento of agendamentos as Agendamento[]) {
    console.log('Processando agendamento:', agendamento.id);

    const { error: lockError } = await supabase
      .from('agendamentos_envio')
      .update({
        status: 'processando',
      })
      .eq('id', agendamento.id)
      .eq('status', 'pendente');

    if (lockError) {
      console.error('Erro ao marcar como processando:', lockError);
      continue;
    }

    try {
      const { data: grupo, error: grupoError } = await supabase
        .from('whatsapp_grupos')
        .select('id, nome, group_jid')
        .eq('id', agendamento.grupo_id)
        .single();

      if (grupoError || !grupo) {
        throw new Error('Grupo não encontrado.');
      }

      if (!agendamento.instancia_id) {
        throw new Error('Agendamento sem instância vinculada.');
      }

      const { data: instancia, error: instanciaError } = await supabase
        .from('whatsapp_instancias')
        .select('id, instance_name, status')
        .eq('id', agendamento.instancia_id)
        .single();

      if (instanciaError || !instancia) {
        throw new Error('Instância não encontrada.');
      }

      if (instancia.status !== 'conectado') {
        throw new Error('Instância não está conectada.');
      }

      if (agendamento.tipo_conteudo !== 'texto') {
        throw new Error(
          `Tipo de conteúdo ainda não suportado no worker: ${agendamento.tipo_conteudo}`,
        );
      }

      if (!agendamento.texto?.trim()) {
        throw new Error('Conteúdo de texto vazio.');
      }

      const evolutionResponse = await enviarTexto(
        instancia as Instancia,
        grupo as Grupo,
        agendamento.texto,
      );

      await supabase
        .from('agendamentos_envio')
        .update({
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          ultimo_erro: null,
        })
        .eq('id', agendamento.id);

      await supabase.from('envios_logs').insert({
        user_id: agendamento.user_id,
        instancia_id: agendamento.instancia_id,
        grupo_id: agendamento.grupo_id,
        campanha_id: agendamento.campanha_id,
        midia_id: agendamento.midia_id,
        agendamento_id: agendamento.id,
        status: 'enviado',
        mensagem: 'Mensagem enviada com sucesso.',
        evolution_response: evolutionResponse,
      });

      console.log('Agendamento enviado:', agendamento.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido.';

      console.error('Erro ao processar agendamento:', {
        agendamentoId: agendamento.id,
        message,
      });

      await marcarComoErro(agendamento, message);
    }
  }
}