begin;

create table if not exists public.rh_beneficios_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  beneficio_nome text not null,
  competencia date not null,
  valor numeric(14,2),
  status text not null default 'liberado',
  motivo text,
  observacoes text,
  created_at timestamptz not null default now()
);

create table if not exists public.rh_descontos_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo text not null,
  descricao text not null,
  competencia date not null,
  valor numeric(14,2) not null default 0,
  status text not null default 'lancado',
  observacoes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rh_beneficios_funcionario_competencia on public.rh_beneficios_lancamentos(empresa_id, funcionario_id, competencia desc);
create index if not exists idx_rh_descontos_funcionario_competencia on public.rh_descontos_lancamentos(empresa_id, funcionario_id, competencia desc);
alter table public.rh_beneficios_lancamentos enable row level security;
alter table public.rh_descontos_lancamentos enable row level security;

drop function if exists public.app_admin_prontuario(text, uuid);
create function public.app_admin_prontuario(p_token text, p_funcionario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_func jsonb;
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.perfil not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  end if;
  select to_jsonb(f) into v_func from public.funcionarios f where f.id = p_funcionario_id and f.empresa_id = v.empresa_id limit 1;
  if v_func is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Funcionário não encontrado');
  end if;
  return jsonb_build_object(
    'sucesso', true,
    'funcionario', v_func,
    'documentos', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from public.funcionario_documentos d where d.funcionario_id = p_funcionario_id and d.empresa_id = v.empresa_id limit 60), '[]'::jsonb),
    'advertencias', coalesce((select jsonb_agg(to_jsonb(a) order by a.data_ocorrencia desc) from public.funcionario_advertencias a where a.funcionario_id = p_funcionario_id and a.empresa_id = v.empresa_id limit 60), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(to_jsonb(t) order by t.data_evento desc, t.created_at desc) from public.funcionario_timeline t where t.funcionario_id = p_funcionario_id and t.empresa_id = v.empresa_id limit 120), '[]'::jsonb),
    'atestados', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.atestados a where a.funcionario_id = p_funcionario_id limit 60), '[]'::jsonb),
    'justificativas', coalesce((select jsonb_agg(to_jsonb(j) order by j.data_registro desc) from public.justificativas_ponto j where j.funcionario_id = p_funcionario_id limit 60), '[]'::jsonb),
    'ponto', coalesce((select jsonb_agg(to_jsonb(r) order by r.data desc) from (select * from public.registros_ponto where funcionario_id = p_funcionario_id order by data desc limit 180) r), '[]'::jsonb),
    'holerites', coalesce((select jsonb_agg(to_jsonb(h) order by h.ano desc, h.mes desc) from (select * from public.holerites where funcionario_id = p_funcionario_id and disponivel = true order by ano desc, mes desc limit 6) h), '[]'::jsonb),
    'ferias', coalesce((select jsonb_agg(to_jsonb(x) order by x.inicio desc) from public.rh_ferias x where x.funcionario_id = p_funcionario_id and x.empresa_id = v.empresa_id limit 60), '[]'::jsonb),
    'afastamentos', coalesce((select jsonb_agg(to_jsonb(x) order by x.inicio desc) from public.rh_afastamentos x where x.funcionario_id = p_funcionario_id and x.empresa_id = v.empresa_id limit 60), '[]'::jsonb),
    'beneficios', coalesce((select jsonb_agg(to_jsonb(x) order by x.competencia desc, x.created_at desc) from public.rh_beneficios_lancamentos x where x.funcionario_id = p_funcionario_id and x.empresa_id = v.empresa_id limit 60), '[]'::jsonb),
    'descontos', coalesce((select jsonb_agg(to_jsonb(x) order by x.competencia desc, x.created_at desc) from public.rh_descontos_lancamentos x where x.funcionario_id = p_funcionario_id and x.empresa_id = v.empresa_id limit 60), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.app_admin_prontuario(text, uuid) to anon, authenticated;
commit;
