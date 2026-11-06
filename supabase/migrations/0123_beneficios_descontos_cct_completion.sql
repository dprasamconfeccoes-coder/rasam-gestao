begin;

-- Completa os editores usados pelo frontend: cadastro, atualização e histórico
-- ficam sempre dentro do tenant autenticado e não expõem tabelas diretamente.
create or replace function public.app_admin_salvar_beneficio_config(
  p_token text, p_id uuid default null, p_nome text default null,
  p_categoria text default 'outro', p_natureza text default 'empresa',
  p_valor numeric default null, p_valor_minimo numeric default null,
  p_percentual numeric default null, p_vigencia_inicio date default current_date,
  p_regra text default null, p_codigo_regra text default null,
  p_fonte text default null, p_motivo text default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid; v_old numeric; v_inicio date := coalesce(p_vigencia_inicio, current_date);
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or v.perfil not in ('admin','administrador','gestor') then
    return jsonb_build_object('sucesso',false,'erro','Acesso negado');
  end if;
  if length(trim(coalesce(p_nome,''))) < 2 then return jsonb_build_object('sucesso',false,'erro','Informe um nome de benefício'); end if;
  if p_valor is not null and p_valor < 0 or p_valor_minimo is not null and p_valor_minimo < 0 then return jsonb_build_object('sucesso',false,'erro','Valores não podem ser negativos'); end if;
  if p_id is null then
    insert into public.rh_beneficios_catalogo(empresa_id,nome,categoria,natureza,valor_atual,valor_minimo,percentual_reajuste,vigencia_inicio,regra_elegibilidade,codigo_regra,fonte_normativa)
    values(v.empresa_id,trim(p_nome),coalesce(nullif(trim(p_categoria),''),'outro'),coalesce(nullif(trim(p_natureza),''),'empresa'),p_valor,p_valor_minimo,p_percentual,v_inicio,nullif(trim(p_regra),''),nullif(trim(p_codigo_regra),''),nullif(trim(p_fonte),'')) returning id into v_id;
  else
    select valor_atual into v_old from public.rh_beneficios_catalogo where id=p_id and empresa_id=v.empresa_id and ativo=true;
    if v_old is null then return jsonb_build_object('sucesso',false,'erro','Benefício não encontrado'); end if;
    update public.rh_beneficios_catalogo set nome=trim(p_nome), categoria=coalesce(nullif(trim(p_categoria),''),'outro'), natureza=coalesce(nullif(trim(p_natureza),''),'empresa'), valor_atual=p_valor, valor_minimo=p_valor_minimo, percentual_reajuste=p_percentual, vigencia_inicio=v_inicio, regra_elegibilidade=nullif(trim(p_regra),''), codigo_regra=nullif(trim(p_codigo_regra),''), fonte_normativa=nullif(trim(p_fonte),'') where id=p_id and empresa_id=v.empresa_id;
    v_id := p_id;
  end if;
  if p_valor is not null then
    update public.rh_beneficios_valores_historico set vigencia_fim=v_inicio-1 where beneficio_id=v_id and empresa_id=v.empresa_id and vigencia_fim is null and vigencia_inicio < v_inicio;
    insert into public.rh_beneficios_valores_historico(empresa_id,beneficio_id,valor,vigencia_inicio,motivo,fonte) values(v.empresa_id,v_id,p_valor,v_inicio,nullif(trim(p_motivo),''),nullif(trim(p_fonte),''));
  end if;
  return jsonb_build_object('sucesso',true,'id',v_id);
exception when unique_violation then
  return jsonb_build_object('sucesso',false,'erro','Já existe um benefício com esse nome');
end; $$;
grant execute on function public.app_admin_salvar_beneficio_config(text,uuid,text,text,text,numeric,numeric,numeric,date,text,text,text,text) to anon,authenticated;

create or replace function public.app_admin_salvar_desconto_config(
  p_token text, p_id uuid default null, p_nome text default null,
  p_categoria text default 'outro', p_fornecedor text default null,
  p_forma text default 'valor_unico', p_valor numeric default null,
  p_vigencia_inicio date default current_date, p_descricao text default null,
  p_motivo text default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_id uuid; v_inicio date := coalesce(p_vigencia_inicio,current_date);
begin
  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null or v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
  if length(trim(coalesce(p_nome,''))) < 2 then return jsonb_build_object('sucesso',false,'erro','Informe um tipo de desconto'); end if;
  if p_valor is not null and p_valor < 0 then return jsonb_build_object('sucesso',false,'erro','O valor padrão não pode ser negativo'); end if;
  if p_id is null then
    insert into public.rh_descontos_catalogo(empresa_id,nome,categoria,fornecedor,forma_cobranca,valor_padrao,descricao)
    values(v.empresa_id,trim(p_nome),coalesce(nullif(trim(p_categoria),''),'outro'),nullif(trim(p_fornecedor),''),coalesce(nullif(trim(p_forma),''),'valor_unico'),p_valor,nullif(trim(p_descricao),'')) returning id into v_id;
  else
    if not exists(select 1 from public.rh_descontos_catalogo where id=p_id and empresa_id=v.empresa_id and ativo=true) then return jsonb_build_object('sucesso',false,'erro','Desconto não encontrado'); end if;
    update public.rh_descontos_catalogo set nome=trim(p_nome),categoria=coalesce(nullif(trim(p_categoria),''),'outro'),fornecedor=nullif(trim(p_fornecedor),''),forma_cobranca=coalesce(nullif(trim(p_forma),''),'valor_unico'),valor_padrao=p_valor,descricao=nullif(trim(p_descricao),'') where id=p_id and empresa_id=v.empresa_id;
    v_id := p_id;
  end if;
  if p_valor is not null then
    update public.rh_descontos_valores_historico set vigencia_fim=v_inicio-1 where desconto_id=v_id and empresa_id=v.empresa_id and vigencia_fim is null and vigencia_inicio < v_inicio;
    insert into public.rh_descontos_valores_historico(empresa_id,desconto_id,valor,vigencia_inicio,motivo) values(v.empresa_id,v_id,p_valor,v_inicio,nullif(trim(p_motivo),''));
  end if;
  return jsonb_build_object('sucesso',true,'id',v_id);
exception when unique_violation then return jsonb_build_object('sucesso',false,'erro','Já existe um desconto com esse nome');
end; $$;
grant execute on function public.app_admin_salvar_desconto_config(text,uuid,text,text,text,text,numeric,date,text,text) to anon,authenticated;

-- CCT 2025-2026 vigente no ambiente: férias não retiram o direito; afastamento
-- previdenciário superior a 30 dias retira. A proporcionalidade é informada para
-- admissão/desligamento no mês, sem alterar a regra de perda por falta injustificada.
create or replace function public.app_admin_simular_vale_cesta(p_token text,p_competencia date,p_beneficio_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v record; v_inicio date; v_fim date; v_valor numeric; v_regra jsonb; v_itens jsonb;
begin
 select * into v from public.app_tenant_usuario(p_token) limit 1;
 if v.usuario_id is null or v.empresa_id is null or v.perfil not in ('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 v_inicio:=date_trunc('month',p_competencia)::date; v_fim:=(v_inicio+interval '1 month - 1 day')::date;
 select coalesce((select h.valor from public.rh_beneficios_valores_historico h where h.empresa_id=v.empresa_id and h.beneficio_id=coalesce(p_beneficio_id,b.id) and h.vigencia_inicio<=v_inicio and (h.vigencia_fim is null or h.vigencia_fim>=v_inicio) order by h.vigencia_inicio desc limit 1),b.valor_atual,0), jsonb_build_object('nome',b.nome,'valor_minimo',b.valor_minimo,'percentual_reajuste',b.percentual_reajuste,'regra',b.regra_elegibilidade,'fonte',b.fonte_normativa) into v_valor,v_regra from public.rh_beneficios_catalogo b where b.empresa_id=v.empresa_id and b.ativo=true and ((p_beneficio_id is null and b.codigo_regra='vale_cesta_cct_2025_2026') or b.id=p_beneficio_id) order by (b.codigo_regra='vale_cesta_cct_2025_2026') desc limit 1;
 v_valor:=greatest(coalesce(v_valor,0),coalesce((v_regra->>'valor_minimo')::numeric,0));
 select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]'::jsonb) into v_itens from (
   select f.id as funcionario_id,f.nome,coalesce(q.injustificadas,0)::int as faltas_injustificadas,coalesce(q.justificadas,0)::int as faltas_justificadas,
     coalesce(q.afastamento_inss,0)::int as dias_afastamento_inss,
     case when coalesce(q.injustificadas,0)>0 or coalesce(q.afastamento_inss,0)>30 then 'nao_elegivel' else 'elegivel' end as resultado,
     case when coalesce(q.injustificadas,0)>0 or coalesce(q.afastamento_inss,0)>30 then 0 else round(v_valor * greatest(0,least(1,(least(coalesce(f.data_saida,v_fim),v_fim)-greatest(coalesce(f.data_admissao,v_inicio),v_inicio)+1)::numeric/(v_fim-v_inicio+1))),2) end as valor,
     case when coalesce(q.injustificadas,0)>0 then 'Falta injustificada ou atraso não abonado no ponto' when coalesce(q.afastamento_inss,0)>30 then 'Afastamento previdenciário superior a 30 dias' else 'Sem falta injustificada registrada; férias mantêm o direito' end as motivo
   from public.funcionarios f left join lateral(
     select count(*) filter(where r.status in ('falta','atraso','atraso_injustificado') and not exists(select 1 from public.justificativas_ponto j where j.funcionario_id=r.funcionario_id and j.data_registro=r.data and j.status in ('aceita','aceito','aprovado'))) as injustificadas,
       count(*) filter(where exists(select 1 from public.justificativas_ponto j where j.funcionario_id=r.funcionario_id and j.data_registro=r.data and j.status in ('aceita','aceito','aprovado'))) as justificadas,
       coalesce((select sum(least(coalesce(a.fim,v_fim),v_fim)-greatest(a.inicio,v_inicio)+1) from public.rh_afastamentos a where a.funcionario_id=f.id and a.status<>'cancelado' and lower(a.tipo) like '%inss%' and a.inicio<=v_fim and coalesce(a.fim,v_fim)>=v_inicio),0) as afastamento_inss
     from public.registros_ponto r where r.funcionario_id=f.id and r.data between v_inicio and v_fim
   ) q on true where f.empresa_id=v.empresa_id and f.ativo=true order by f.nome limit 500
 ) x;
 return jsonb_build_object('sucesso',true,'competencia',to_char(v_inicio,'YYYY-MM'),'valor',v_valor,'regra',v_regra,'itens',v_itens,'observacao','Simulação conforme CCT 2025-2026, Cláusula Décima Terceira: somente falta injustificada perde o vale; férias mantêm. Afastamento INSS superior a 30 dias perde. Admissão/desligamento no mês é proporcional.');
end; $$;
grant execute on function public.app_admin_simular_vale_cesta(text,date,uuid) to anon,authenticated;

commit;
