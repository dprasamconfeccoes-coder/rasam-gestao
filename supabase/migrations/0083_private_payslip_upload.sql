-- Importação administrativa de holerites em PDF no bucket privado.
-- O frontend continua usando RPCs com token próprio; nenhum acesso direto às tabelas é necessário.

begin;

alter table public.holerites
  add column if not exists storage_path text,
  add column if not exists mime_type text not null default 'application/pdf',
  add column if not exists tamanho_bytes bigint;

create index if not exists idx_holerites_funcionario_competencia
  on public.holerites(funcionario_id, ano desc, mes desc);

create or replace function public.app_admin_holerite_preflight(
  p_token text,
  p_funcionario_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  f record;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('gestor', 'administrador', 'admin') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  end if;

  select id, nome, cpf, empresa_id, ativo, coalesce(elegivel_holerite, tipo_vinculo = 'formal') as elegivel_holerite
    into f
    from public.funcionarios
   where id = p_funcionario_id
     and empresa_id = v.empresa_id
   limit 1;

  if f.id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado nesta empresa');
  end if;
  if not coalesce(f.ativo, false) then
    return jsonb_build_object('sucesso', false, 'erro', 'O funcionário está inativo');
  end if;
  if not coalesce(f.elegivel_holerite, false) then
    return jsonb_build_object('sucesso', false, 'erro', 'Este vínculo não está elegível para holerite');
  end if;

  return jsonb_build_object('sucesso', true, 'empresa_id', v.empresa_id, 'funcionario_id', f.id, 'nome', f.nome, 'cpf', f.cpf);
end;
$$;

grant execute on function public.app_admin_holerite_preflight(text, uuid) to anon, authenticated;

create or replace function public.app_admin_registrar_holerite_upload(
  p_token text,
  p_funcionario_id uuid,
  p_mes integer,
  p_ano integer,
  p_storage_path text,
  p_arquivo_nome text,
  p_mime_type text,
  p_tamanho_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  f record;
  v_id uuid;
  v_path text;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.perfil not in ('gestor', 'administrador', 'admin') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  end if;
  if p_mes not between 1 and 12 or p_ano not between 2000 and 2100 then
    return jsonb_build_object('sucesso', false, 'erro', 'Competência inválida');
  end if;
  if coalesce(p_mime_type, '') <> 'application/pdf' or coalesce(p_tamanho_bytes, 0) < 1 or p_tamanho_bytes > 10485760 then
    return jsonb_build_object('sucesso', false, 'erro', 'O arquivo deve ser um PDF de até 10 MB');
  end if;

  select id, nome, ativo, coalesce(elegivel_holerite, tipo_vinculo = 'formal') as elegivel_holerite
    into f
    from public.funcionarios
   where id = p_funcionario_id
     and empresa_id = v.empresa_id
   limit 1;
  if f.id is null or not coalesce(f.ativo, false) or not coalesce(f.elegivel_holerite, false) then
    return jsonb_build_object('sucesso', false, 'erro', 'Funcionário não elegível para holerite');
  end if;

  v_path := btrim(coalesce(p_storage_path, ''));
  if length(v_path) < 20 or length(v_path) > 512 or v_path !~ ('^' || v.empresa_id::text || '/holerites/' || p_funcionario_id::text || '/[0-9]{4}-[0-9]{2}/[A-Za-z0-9_.-]{1,240}$') then
    return jsonb_build_object('sucesso', false, 'erro', 'Caminho privado do documento inválido');
  end if;

  select id into v_id
    from public.holerites
   where funcionario_id = p_funcionario_id
     and empresa_id = v.empresa_id
     and mes = p_mes
     and ano = p_ano
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.holerites(funcionario_id, empresa_id, mes, ano, arquivo_nome, arquivo_url, storage_path, mime_type, tamanho_bytes, disponivel)
    values(p_funcionario_id, v.empresa_id, p_mes, p_ano, left(btrim(p_arquivo_nome), 255), v_path, v_path, 'application/pdf', p_tamanho_bytes, true)
    returning id into v_id;
  else
    update public.holerites
       set arquivo_nome = left(btrim(p_arquivo_nome), 255), arquivo_url = v_path, storage_path = v_path,
           mime_type = 'application/pdf', tamanho_bytes = p_tamanho_bytes, disponivel = true
     where id = v_id;
  end if;

  insert into public.auditoria_acoes(usuario_id, acao, entidade, entidade_id, detalhes)
  values(v.usuario_id, 'importou_holerite', 'holerites', v_id, jsonb_build_object('funcionario_id', p_funcionario_id, 'mes', p_mes, 'ano', p_ano, 'arquivo_nome', p_arquivo_nome));

  return jsonb_build_object('sucesso', true, 'id', v_id, 'arquivo_nome', p_arquivo_nome);
end;
$$;

grant execute on function public.app_admin_registrar_holerite_upload(text, uuid, integer, integer, text, text, text, bigint) to anon, authenticated;

create or replace function public.app_holerite_documento_path(
  p_token text,
  p_holerite_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  h record;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  end if;

  select h.id, h.storage_path, h.arquivo_nome, h.mime_type, h.funcionario_id
    into h
    from public.holerites h
   where h.id = p_holerite_id
     and h.empresa_id = v.empresa_id
     and h.disponivel = true
   limit 1;
  if h.id is null or h.storage_path is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Holerite privado não encontrado');
  end if;
  if v.perfil not in ('gestor', 'administrador', 'admin') and h.funcionario_id <> v.funcionario_id then
    return jsonb_build_object('sucesso', false, 'erro', 'Você não tem acesso a este holerite');
  end if;

  return jsonb_build_object('sucesso', true, 'caminho', h.storage_path, 'nome', h.arquivo_nome, 'mime_type', h.mime_type);
end;
$$;

grant execute on function public.app_holerite_documento_path(text, uuid) to anon, authenticated;

commit;
