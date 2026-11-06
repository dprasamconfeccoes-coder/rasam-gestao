begin;

alter table public.rh_ferias_import_linhas
  add column if not exists storage_path text,
  add column if not exists mime_type text not null default 'application/pdf',
  add column if not exists tamanho_bytes bigint,
  add column if not exists sha256 text;

create index if not exists idx_rh_ferias_import_linhas_sha on public.rh_ferias_import_linhas(empresa_id, sha256);

create or replace function public.app_admin_vincular_ferias_importacao_linha(
  p_token text, p_linha_id uuid, p_funcionario_id uuid,
  p_periodo_inicio date, p_periodo_fim date,
  p_inicio date, p_fim date, p_retorno date default null,
  p_tipo text default 'aviso', p_observacoes text default null
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; l record; v_ferias uuid; v_doc uuid; v_dup uuid; v_status text;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if;
  if p_tipo not in ('aviso','recibo','comprovante_pagamento') then return jsonb_build_object('sucesso',false,'erro','Tipo de documento inválido'); end if;
  if p_periodo_inicio is null or p_periodo_fim is null or p_periodo_inicio>p_periodo_fim then return jsonb_build_object('sucesso',false,'erro','Período aquisitivo inválido'); end if;
  if p_inicio is null or p_fim is null or p_inicio>p_fim then return jsonb_build_object('sucesso',false,'erro','Período de gozo inválido'); end if;
  if not exists(select 1 from public.funcionarios f where f.id=p_funcionario_id and f.empresa_id=v.empresa_id and f.ativo=true) then return jsonb_build_object('sucesso',false,'erro','Funcionário ativo não encontrado'); end if;
  select * into l from public.rh_ferias_import_linhas where id=p_linha_id and empresa_id=v.empresa_id limit 1;
  if l.id is null then return jsonb_build_object('sucesso',false,'erro','Linha de importação não encontrada'); end if;
  select r.id into v_dup from public.rh_ferias r where r.empresa_id=v.empresa_id and r.funcionario_id=p_funcionario_id and r.periodo_aquisitivo_inicio=p_periodo_inicio and r.periodo_aquisitivo_fim=p_periodo_fim and r.inicio=p_inicio and r.fim=p_fim and r.status<>'cancelada' limit 1;
  if v_dup is not null and l.ferias_id is distinct from v_dup then update public.rh_ferias_import_linhas set funcionario_id=p_funcionario_id,status='divergente',divergencia='Duplicidade: já existe período idêntico no sistema',ferias_id=v_dup,updated_at=now() where id=l.id; return jsonb_build_object('sucesso',false,'duplicidade',true,'ferias_id',v_dup,'erro','Já existe um período idêntico para este funcionário'); end if;
  if l.ferias_id is null then
    insert into public.rh_ferias(empresa_id,funcionario_id,periodo_aquisitivo_inicio,periodo_aquisitivo_fim,inicio,fim,status,observacoes,retorno_em,aviso_emitido_em,origem_importacao,importacao_status)
    values(v.empresa_id,p_funcionario_id,p_periodo_inicio,p_periodo_fim,p_inicio,p_fim,'agendada',nullif(trim(p_observacoes),''),p_retorno,current_date,'app_upload','vinculada') returning id into v_ferias;
  else v_ferias:=l.ferias_id; update public.rh_ferias set funcionario_id=p_funcionario_id,periodo_aquisitivo_inicio=p_periodo_inicio,periodo_aquisitivo_fim=p_periodo_fim,inicio=p_inicio,fim=p_fim,retorno_em=p_retorno,observacoes=coalesce(nullif(trim(p_observacoes),''),observacoes),updated_at=now() where id=v_ferias and empresa_id=v.empresa_id; end if;
  if l.storage_path is not null then
    insert into public.rh_ferias_documentos(empresa_id,funcionario_id,ferias_id,tipo,arquivo_nome,storage_path,mime_type,tamanho_bytes,sha256,status_conferencia)
    values(v.empresa_id,p_funcionario_id,v_ferias,p_tipo,l.arquivo_nome,l.storage_path,l.mime_type,l.tamanho_bytes,l.sha256,'pendente') returning id into v_doc;
  end if;
  update public.rh_ferias_import_linhas set funcionario_id=p_funcionario_id,periodo_aquisitivo_inicio=p_periodo_inicio,periodo_aquisitivo_fim=p_periodo_fim,inicio=p_inicio,fim=p_fim,retorno_em=p_retorno,ferias_id=v_ferias,documento_id=coalesce(v_doc,documento_id),status='vinculada',divergencia=null,updated_at=now() where id=l.id;
  update public.rh_ferias_importacoes set linhas_vinculadas=(select count(*) from public.rh_ferias_import_linhas x where x.importacao_id=l.importacao_id and x.status in ('vinculada','conferida')),linhas_pendentes=(select count(*) from public.rh_ferias_import_linhas x where x.importacao_id=l.importacao_id and x.status in ('pendente','divergente')),status=case when (select count(*) from public.rh_ferias_import_linhas x where x.importacao_id=l.importacao_id and x.status in ('pendente','divergente'))=0 then 'parcial' else 'parcial' end,updated_at=now() where id=l.importacao_id;
  insert into public.auditoria_acoes(usuario_id,acao,entidade,entidade_id,detalhes) values(v.usuario_id,'vinculou_importacao_ferias','rh_ferias_import_linhas',l.id,jsonb_build_object('ferias_id',v_ferias,'funcionario_id',p_funcionario_id,'documento_id',v_doc));
  return jsonb_build_object('sucesso',true,'ferias_id',v_ferias,'documento_id',v_doc);
end; $$;
grant execute on function public.app_admin_vincular_ferias_importacao_linha(text,uuid,uuid,date,date,date,date,date,text,text) to anon,authenticated;

create or replace function public.app_admin_rejeitar_ferias_importacao(p_token text,p_id uuid,p_observacoes text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$ declare v record; l record; begin select * into v from public.app_tenant_usuario(p_token) limit 1; if v.usuario_id is null or v.perfil not in ('admin','administrador') then return jsonb_build_object('sucesso',false,'erro','Acesso restrito ao administrador'); end if; select * into l from public.rh_ferias_import_linhas where id=p_id and empresa_id=v.empresa_id limit 1; if l.id is null then return jsonb_build_object('sucesso',false,'erro','Linha de importação não encontrada'); end if; update public.rh_ferias_import_linhas set status='rejeitada',divergencia=coalesce(nullif(trim(p_observacoes),''),'Rejeitada pelo RH'),updated_at=now() where id=p_id; update public.rh_ferias_importacoes set linhas_pendentes=(select count(*) from public.rh_ferias_import_linhas x where x.importacao_id=l.importacao_id and x.status in ('pendente','vinculada','divergente')),updated_at=now() where id=l.importacao_id; insert into public.auditoria_acoes(usuario_id,acao,entidade,entidade_id,detalhes) values(v.usuario_id,'rejeitou_importacao_ferias','rh_ferias_import_linhas',p_id,jsonb_build_object('motivo',p_observacoes)); return jsonb_build_object('sucesso',true,'id',p_id); end; $$;
grant execute on function public.app_admin_rejeitar_ferias_importacao(text,uuid,text) to anon,authenticated;

commit;
