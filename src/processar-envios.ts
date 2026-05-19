import { supabase } from './supabase';
import {
  sendAudioMessage,
  sendMediaMessage,
  sendTextMessage,
} from './evolution';

type TipoConteudo =
  | 'texto'
  | 'imagem'
  | 'imagem_texto'
  | 'audio'
  | 'audio_texto'
  | 'video'
  | 'video_texto'
  | 'documento';

type Agendamento = {
  id: string;
  user_id: string;
  campanha_id: string | null;
  midia_id: string | null;
  grupo_id: string;
  instancia_id: string | null;
  tipo_conteudo: TipoConteudo | null;
  conteudo_url: string | null;
  texto: string | null;
  nome_arquivo: string | null;
  mime_type: string | null;
  tentativas: number | null;
  enviar_em: string;
  status: string;
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

async function criarLog(params: {
  agendamento: Agendamento;
  status: 'enviado' | 'erro';
  mensagem: string;
  erro?: string | null;
  evolutionResponse?: unknown;
}) {
  const { agendamento, status, mensagem, erro = null, evolutionResponse = null } =
    params;

  const { error } = await supabase.from('envios_logs').insert({
    user_id: agendamento.user_id,
    instancia_id: agendamento.instancia_id,
    grupo_id: agendamento.grupo_id,
    campanha_id: agendamento.campanha_id,
    midia_id: agendamento.midia_id,
    agendamento_id: agendamento.id,
    status,
    mensagem,
    erro,
    evolution_response: evolutionResponse,
  });

  if (error) {
    console.error('Erro ao criar log de envio:', {
      agendamentoId: agendamento.id,
      error,
    });
  }
}

async function marcarComoErro(agendamento: Agendamento, erro: string) {
  const tentativas = (agendamento.tentativas ?? 0) + 1;
  const statusFinal = tentativas >= 3 ? 'erro' : 'pendente';

  console.log('Marcando agendamento como erro:', {
    agendamentoId: agendamento.id,
    tentativas,
    statusFinal,
    erro,
  });

  const { error: updateError } = await supabase
    .from('agendamentos_envio')
    .update({
      status: statusFinal,
      tentativas,
      ultimo_erro: erro,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agendamento.id);

  if (updateError) {
    console.error('Erro ao atualizar agendamento com erro:', {
      agendamentoId: agendamento.id,
      updateError,
    });
  }

  await criarLog({
    agendamento,
    status: 'erro',
    mensagem: erro,
    erro,
  });
}

async function buscarGrupo(grupoId: string) {
  const { data, error } = await supabase
    .from('whatsapp_grupos')
    .select('id, nome, group_jid')
    .eq('id', grupoId)
    .single();

  if (error || !data) {
    console.error('Erro ao buscar grupo:', {
      grupoId,
      error,
    });

    throw new Error('Grupo não encontrado.');
  }

  if (!data.group_jid?.endsWith('@g.us')) {
    throw new Error(`Group JID inválido: ${data.group_jid}`);
  }

  return data as Grupo;
}

async function buscarInstancia(instanciaId: string) {
  const { data, error } = await supabase
    .from('whatsapp_instancias')
    .select('id, instance_name, status')
    .eq('id', instanciaId)
    .single();

  if (error || !data) {
    console.error('Erro ao buscar instância:', {
      instanciaId,
      error,
    });

    throw new Error('Instância não encontrada.');
  }

  return data as Instancia;
}

async function tentarBloquearAgendamento(agendamentoId: string) {
  const { data, error } = await supabase
    .from('agendamentos_envio')
    .update({
      status: 'processando',
      updated_at: new Date().toISOString(),
    })
    .eq('id', agendamentoId)
    .eq('status', 'pendente')
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('Erro ao marcar como processando:', {
      agendamentoId,
      error,
    });

    return false;
  }

  if (!data) {
    console.log('Agendamento não foi bloqueado. Talvez outro worker pegou:', {
      agendamentoId,
    });

    return false;
  }

  return true;
}

function assertTexto(texto: string | null | undefined) {
  const value = texto?.trim();

  if (!value) {
    throw new Error('Conteúdo de texto vazio.');
  }

  return value;
}

function assertConteudoUrl(url: string | null | undefined) {
  const value = url?.trim();

  if (!value) {
    throw new Error('Conteúdo com arquivo sem URL pública.');
  }

  return value;
}

async function processarConteudo(params: {
  agendamento: Agendamento;
  instancia: Instancia;
  grupo: Grupo;
}) {
  const { agendamento, instancia, grupo } = params;

  const tipo = agendamento.tipo_conteudo;

  console.log('Processando conteúdo:', {
    agendamentoId: agendamento.id,
    tipo,
    conteudoUrl: agendamento.conteudo_url,
    mimeType: agendamento.mime_type,
    nomeArquivo: agendamento.nome_arquivo,
  });

  if (tipo === 'texto') {
    const texto = assertTexto(agendamento.texto);

    return sendTextMessage({
      instanceName: instancia.instance_name,
      number: grupo.group_jid,
      text: texto,
    });
  }

  if (tipo === 'imagem' || tipo === 'imagem_texto') {
    const media = assertConteudoUrl(agendamento.conteudo_url);
    const caption =
      tipo === 'imagem_texto' ? assertTexto(agendamento.texto) : null;

    return sendMediaMessage({
      instanceName: instancia.instance_name,
      number: grupo.group_jid,
      mediatype: 'image',
      media,
      mimetype: agendamento.mime_type ?? 'image/jpeg',
      fileName: agendamento.nome_arquivo ?? 'imagem.jpg',
      caption,
    });
  }

  if (tipo === 'audio') {
    const audio = assertConteudoUrl(agendamento.conteudo_url);

    return sendAudioMessage({
      instanceName: instancia.instance_name,
      number: grupo.group_jid,
      audio,
    });
  }

  if (tipo === 'audio_texto') {
    const audio = assertConteudoUrl(agendamento.conteudo_url);
    const texto = assertTexto(agendamento.texto);

    const audioResponse = await sendAudioMessage({
      instanceName: instancia.instance_name,
      number: grupo.group_jid,
      audio,
    });

    const textResponse = await sendTextMessage({
      instanceName: instancia.instance_name,
      number: grupo.group_jid,
      text: texto,
    });

    return {
      audioResponse,
      textResponse,
    };
  }

  throw new Error(`Tipo de conteúdo ainda não suportado no worker: ${tipo}`);
}

export async function processarEnvios() {
  const agora = new Date().toISOString();

  console.log('Buscando agendamentos pendentes:', {
    agora,
  });

  const { data: agendamentos, error } = await supabase
    .from('agendamentos_envio')
    .select(
      `
      id,
      user_id,
      campanha_id,
      midia_id,
      grupo_id,
      instancia_id,
      tipo_conteudo,
      conteudo_url,
      texto,
      nome_arquivo,
      mime_type,
      tentativas,
      enviar_em,
      status
    `,
    )
    .eq('status', 'pendente')
    .lte('enviar_em', agora)
    .order('enviar_em', { ascending: true })
    .limit(5);

  console.log('Busca de agendamentos executada:', {
    agora,
    total: agendamentos?.length ?? 0,
    ids: agendamentos?.map((item) => item.id) ?? [],
  });

  if (error) {
    console.error('Erro ao buscar agendamentos:', error);
    return;
  }

  if (!agendamentos || agendamentos.length === 0) {
    console.log('Nenhum agendamento pendente para processar neste ciclo.');
    return;
  }

  for (const agendamento of agendamentos as Agendamento[]) {
    console.log('Iniciando processamento do agendamento:', {
      id: agendamento.id,
      enviar_em: agendamento.enviar_em,
      tipo_conteudo: agendamento.tipo_conteudo,
      tentativas: agendamento.tentativas ?? 0,
    });

    const bloqueado = await tentarBloquearAgendamento(agendamento.id);

    if (!bloqueado) {
      continue;
    }

    try {
      if (!agendamento.grupo_id) {
        throw new Error('Agendamento sem grupo vinculado.');
      }

      if (!agendamento.instancia_id) {
        throw new Error('Agendamento sem instância vinculada.');
      }

      const grupo = await buscarGrupo(agendamento.grupo_id);
      const instancia = await buscarInstancia(agendamento.instancia_id);

      console.log('Dados carregados para envio:', {
        agendamentoId: agendamento.id,
        grupo: {
          id: grupo.id,
          nome: grupo.nome,
          group_jid: grupo.group_jid,
        },
        instancia: {
          id: instancia.id,
          instance_name: instancia.instance_name,
          status: instancia.status,
        },
      });

      if (instancia.status !== 'conectado') {
        throw new Error(
          `Instância não está conectada. Status atual: ${instancia.status}`,
        );
      }

      const evolutionResponse = await processarConteudo({
        agendamento,
        instancia,
        grupo,
      });

      console.log('Resposta da Evolution recebida:', {
        agendamentoId: agendamento.id,
        evolutionResponse,
      });

      const { error: updateError } = await supabase
        .from('agendamentos_envio')
        .update({
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          ultimo_erro: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', agendamento.id);

      if (updateError) {
        console.error('Mensagem enviada, mas erro ao marcar como enviado:', {
          agendamentoId: agendamento.id,
          updateError,
        });

        throw new Error('Mensagem enviada, mas erro ao atualizar status.');
      }

      await criarLog({
        agendamento,
        status: 'enviado',
        mensagem: 'Mensagem enviada com sucesso.',
        evolutionResponse,
      });

      console.log('Agendamento enviado com sucesso:', agendamento.id);
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
