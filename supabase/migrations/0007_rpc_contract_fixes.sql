-- RF Gestão: contratos RPC sem ambiguidades de PL/pgSQL e sem colunas inexistentes.
create or replace function public.app_listar_funcionarios(p_token text)
returns table(id uuid,nome text,cpf text,cargo text,data_admissao date,salario numeric,ativo boolean,perfil text)
language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text;
begin
 select au.perfil into v_perfil from public.app_usuario_por_token(p_token) au limit 1;
 if v_perfil not in('admin','administrador','gestor') then return; end if;
 return query select f.id,f.nome::text,f.cpf::text,f.cargo::text,f.data_admissao,f.salario,f.ativo,coalesce(u.perfil,'funcionario')::text
 from public.funcionarios f left join public.usuarios u on u.funcionario_id=f.id
 order by f.ativo desc,f.nome limit 500;
end; $$;

create or replace function public.app_listar_ordens(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_perfil text; v_result jsonb;
begin
 select au.perfil into v_perfil from public.app_usuario_por_token(p_token) au limit 1;
 if v_perfil not in('admin','administrador','gestor') then return jsonb_build_object('sucesso',false,'erro','Acesso negado'); end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.prazo nulls last),'[]'::jsonb) into v_result
 from (select o.id,o.numero,o.descricao,o.status,o.prioridade,o.data_entrada,o.prazo,o.quantidade,o.valor_total,c.nome as cliente
       from public.ordens_servico o left join public.clientes c on c.id=o.cliente_id
       order by o.prazo nulls last limit 300) x;
 return jsonb_build_object('sucesso',true,'ordens',v_result);
end; $$;
