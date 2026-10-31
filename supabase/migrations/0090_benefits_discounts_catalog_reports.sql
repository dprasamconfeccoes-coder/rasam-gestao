begin;

alter table public.rh_beneficios_catalogo add column if not exists categoria text not null default 'outro';
alter table public.rh_beneficios_catalogo add column if not exists natureza text not null default 'empresa';
alter table public.rh_beneficios_catalogo add column if not exists regra_elegibilidade text;
alter table public.rh_beneficios_catalogo add column if not exists codigo_regra text;
alter table public.rh_beneficios_catalogo add column if not exists valor_atual numeric(14,2);
alter table public.rh_beneficios_catalogo add column if not exists valor_minimo numeric(14,2);
alter table public.rh_beneficios_catalogo add column if not exists percentual_reajuste numeric(8,4);
alter table public.rh_beneficios_catalogo add column if not exists vigencia_inicio date;
alter table public.rh_beneficios_catalogo add column if not exists fonte_normativa text;
alter table public.rh_descontos_catalogo add column if not exists categoria text not null default 'outro';
alter table public.rh_descontos_catalogo add column if not exists fornecedor text;
alter table public.rh_descontos_catalogo add column if not exists forma_cobranca text not null default 'valor_unico';
alter table public.rh_descontos_catalogo add column if not exists valor_padrao numeric(14,2);

create table if not exists public.rh_beneficios_valores_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  beneficio_id uuid not null references public.rh_beneficios_catalogo(id) on delete cascade,
  valor numeric(14,2) not null,
  vigencia_inicio date not null,
  vigencia_fim date,
  motivo text,
  fonte text,
  created_at timestamptz not null default now()
);
create table if not exists public.rh_descontos_valores_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  desconto_id uuid not null references public.rh_descontos_catalogo(id) on delete cascade,
  valor numeric(14,2) not null,
  vigencia_inicio date not null,
  vigencia_fim date,
  motivo text,
  fonte text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rh_beneficios_valores_vigencia on public.rh_beneficios_valores_historico(empresa_id,beneficio_id,vigencia_inicio desc);
create index if not exists idx_rh_descontos_valores_vigencia on public.rh_descontos_valores_historico(empresa_id,desconto_id,vigencia_inicio desc);
alter table public.rh_beneficios_valores_historico enable row level security;
alter table public.rh_descontos_valores_historico enable row level security;

update public.rh_beneficios_catalogo set categoria='alimentacao', natureza='convencional', codigo_regra='vale_cesta_cct_2025_2026', regra_elegibilidade='Perde somente por falta injustificada no mês. Faltas justificadas/abonadas, férias e licença-maternidade mantêm o direito. Afastamento INSS superior a 30 dias perde o direito. Admissão e demissão são proporcionais aos dias trabalhados.', valor_minimo=240, percentual_reajuste=20, fonte_normativa='CCT 2025-2026 · Cláusula Décima Terceira' where lower(nome) in ('vale cesta','vale cesta alimentação') and codigo_regra is null;

create or replace function public.app_admin_catalogo_folha(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;
 if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 return jsonb_build_object('sucesso',true,
  'beneficios',coalesce((select jsonb_agg(to_jsonb(x) order by x.nome) from (select b.*,coalesce((select jsonb_agg(to_jsonb(h) order by h.vigencia_inicio desc) from public.rh_beneficios_valores_historico h where h.beneficio_id=b.id and h.empresa_id=v.empresa_id limit 50),'[]'::jsonb) as historico_valores from public.rh_beneficios_catalogo b where b.empresa_id=v.empresa_id and b.ativo=true order by b.nome limit 100)x),'[]'::jsonb),
  'descontos',coalesce((select jsonb_agg(to_jsonb(x) order by x.nome) from (select d.*,coalesce((select jsonb_agg(to_jsonb(h) order by h.vigencia_inicio desc) from public.rh_descontos_valores_historico h where h.desconto_id=d.id and h.empresa_id=v.empresa_id limit 50),'[]'::jsonb) as historico_valores from public.rh_descontos_catalogo d where d.empresa_id=v.empresa_id and d.ativo=true order by d.nome limit 100)x),'[]'::jsonb));
end; $$;
grant execute on function public.app_admin_catalogo_folha(text) to anon,authenticated;

create or replace function public.app_admin_simular_vale_cesta(p_token text,p_competencia date,p_beneficio_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_inicio date; v_fim date; v_valor numeric; v_regra jsonb; v_itens jsonb;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;
 if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 v_inicio:=date_trunc('month',p_competencia)::date; v_fim:=(v_inicio+interval '1 month - 1 day')::date;
 select coalesce((select h.valor from public.rh_beneficios_valores_historico h where h.empresa_id=v.empresa_id and h.beneficio_id=coalesce(p_beneficio_id,b.id) and h.vigencia_inicio<=v_inicio and (h.vigencia_fim is null or h.vigencia_fim>=v_inicio) order by h.vigencia_inicio desc limit 1),b.valor_atual,0), jsonb_build_object('nome',b.nome,'valor_minimo',b.valor_minimo,'percentual_reajuste',b.percentual_reajuste,'regra',b.regra_elegibilidade,'fonte',b.fonte_normativa) into v_valor,v_regra from public.rh_beneficios_catalogo b where b.empresa_id=v.empresa_id and b.ativo=true and (p_beneficio_id is null and b.codigo_regra='vale_cesta_cct_2025_2026' or b.id=p_beneficio_id) order by (b.codigo_regra='vale_cesta_cct_2025_2026') desc limit 1;
 if v_valor is null then v_valor:=0; end if;
 if (v_regra->>'valor_minimo') is not null and v_valor < (v_regra->>'valor_minimo')::numeric then v_valor:=(v_regra->>'valor_minimo')::numeric; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]'::jsonb) into v_itens from (select f.id as funcionario_id,f.nome,coalesce(q.injustificadas,0)::int as faltas_injustificadas,coalesce(q.atestados,0)::int as faltas_justificadas,case when coalesce(q.injustificadas,0)=0 then 'elegivel' else 'nao_elegivel' end as resultado,case when coalesce(q.injustificadas,0)=0 then v_valor else 0 end as valor,case when coalesce(q.injustificadas,0)=0 then 'Sem falta injustificada registrada' else 'Falta injustificada ou atraso não abonado no ponto' end as motivo from public.funcionarios f left join lateral(select count(*) filter(where r.status in ('falta','atraso','atraso_injustificado') and not exists(select 1 from public.justificativas_ponto j where j.funcionario_id=r.funcionario_id and j.data_registro=r.data and j.status in ('aceita','aceito','aprovado'))) as injustificadas,count(*) filter(where exists(select 1 from public.justificativas_ponto j where j.funcionario_id=r.funcionario_id and j.data_registro=r.data and j.status in ('aceita','aceito','aprovado'))) as atestados from public.registros_ponto r where r.funcionario_id=f.id and r.data between v_inicio and v_fim) q on true where f.empresa_id=v.empresa_id and f.ativo=true order by f.nome limit 500)x;
 return jsonb_build_object('sucesso',true,'competencia',to_char(v_inicio,'YYYY-MM'),'valor',v_valor,'regra',v_regra,'itens',v_itens,'observacao','A simulação usa faltas e atrasos registrados no ponto e justificativas aceitas. Afastamento INSS superior a 30 dias exige conferência cadastral antes da confirmação.');
end; $$;
grant execute on function public.app_admin_simular_vale_cesta(text,date,uuid) to anon,authenticated;

create or replace function public.app_admin_relatorio_folha(p_token text,p_competencia date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_comp text; v_beneficios jsonb; v_descontos jsonb; v_pessoas jsonb;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;
 if v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 v_comp:=to_char(date_trunc('month',p_competencia),'YYYY-MM');
 select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb) into v_beneficios from (select b.beneficio_nome as nome,count(*)::int as pessoas,coalesce(sum(b.valor),0) as total from public.rh_beneficios_lancamentos b where b.empresa_id=v.empresa_id and to_char(b.competencia,'YYYY-MM')=v_comp group by b.beneficio_nome limit 100)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb) into v_descontos from (select d.tipo,d.descricao,count(*)::int as pessoas,coalesce(sum(d.valor),0) as total from public.rh_descontos_lancamentos d where d.empresa_id=v.empresa_id and to_char(d.competencia,'YYYY-MM')=v_comp and d.status<>'cancelado' group by d.tipo,d.descricao limit 100)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb) into v_pessoas from (select f.nome,coalesce(sum(z.total),0) as total from public.funcionarios f join (select b.funcionario_id,coalesce(b.valor,0) as total from public.rh_beneficios_lancamentos b where b.empresa_id=v.empresa_id and to_char(b.competencia,'YYYY-MM')=v_comp union all select d.funcionario_id,-coalesce(d.valor,0) from public.rh_descontos_lancamentos d where d.empresa_id=v.empresa_id and to_char(d.competencia,'YYYY-MM')=v_comp and d.status<>'cancelado')z on z.funcionario_id=f.id where f.empresa_id=v.empresa_id group by f.nome limit 100)x;
 return jsonb_build_object('sucesso',true,'competencia',v_comp,'total_beneficios',coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(v_beneficios)x),0),'total_descontos',coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(v_descontos)x),0),'beneficios',v_beneficios,'descontos',v_descontos,'por_funcionario',v_pessoas);
end; $$;
grant execute on function public.app_admin_relatorio_folha(text,date) to anon,authenticated;

commit;
