begin;

-- O banco ativo já possui estes campos; IF NOT EXISTS também mantém a migration
-- aplicável em instalações cuja árvore local ainda não contém a migration da ficha.
alter table public.funcionarios
  add column if not exists matricula_esocial varchar(20),
  add column if not exists numero_registro varchar(20),
  add column if not exists empregador_razao_social varchar(200),
  add column if not exists empregador_cnpj varchar(18),
  add column if not exists empregador_endereco text,
  add column if not exists local_nascimento varchar(100),
  add column if not exists pais_nacionalidade varchar(50),
  add column if not exists estado_civil varchar(20),
  add column if not exists sexo varchar(10),
  add column if not exists cor_raca varchar(20),
  add column if not exists grau_instrucao varchar(30),
  add column if not exists deficiencia varchar(10),
  add column if not exists nome_pai varchar(100),
  add column if not exists nome_mae varchar(100),
  add column if not exists rg varchar(20),
  add column if not exists rg_data_emissao date,
  add column if not exists rg_orgao_emissor varchar(20),
  add column if not exists titulo_eleitor varchar(20),
  add column if not exists titulo_zona varchar(10),
  add column if not exists titulo_secao varchar(10),
  add column if not exists inscricao_orgao_classe varchar(30),
  add column if not exists ctps varchar(20),
  add column if not exists ctps_serie varchar(10),
  add column if not exists ctps_data_expedicao date,
  add column if not exists ctps_uf varchar(2),
  add column if not exists cnh varchar(20),
  add column if not exists cnh_categoria varchar(5),
  add column if not exists doc_militar varchar(20),
  add column if not exists doc_militar_categoria varchar(10),
  add column if not exists endereco text,
  add column if not exists cep varchar(9),
  add column if not exists telefone_residencial varchar(20),
  add column if not exists telefone_celular varchar(20),
  add column if not exists cargo varchar(50),
  add column if not exists funcao varchar(50),
  add column if not exists cbo varchar(10),
  add column if not exists data_admissao date,
  add column if not exists data_saida date,
  add column if not exists tipo_desligamento varchar(100),
  add column if not exists salario numeric(14,2),
  add column if not exists salario_periodo varchar(10),
  add column if not exists salario_admissao numeric(14,2),
  add column if not exists horario_trabalho varchar(50),
  add column if not exists horario_intervalo varchar(50),
  add column if not exists fgts_opcao date,
  add column if not exists fgts_conta_banco varchar(30),
  add column if not exists fgts_data_retificacao date,
  add column if not exists pis_cadastro date,
  add column if not exists pis_numero varchar(20),
  add column if not exists banco_domicilio varchar(50),
  add column if not exists banco_numero varchar(10),
  add column if not exists banco_agencia varchar(10),
  add column if not exists banco_endereco text,
  add column if not exists alteracoes text,
  add column if not exists ferias_periodo_aquisitivo text,
  add column if not exists ferias_periodo_gozo text,
  add column if not exists ferias_periodo_abono text,
  add column if not exists acidentes_doencas text,
  add column if not exists contribuicao_sindical text,
  add column if not exists observacoes text,
  add column if not exists beneficiarios text;

alter table public.funcionarios
  drop constraint if exists funcionarios_remuneracao_por_vinculo_check;

alter table public.funcionarios
  add constraint funcionarios_remuneracao_por_vinculo_check check (
    (
      tipo_vinculo = 'diarista'
      and salario is null
      and valor_mensal is null
      and salario_periodo = 'Diária'
      and (
        (cadastro_tipo = 'basico' and valor_diaria is null)
        or (valor_diaria is not null and valor_diaria > 0)
      )
    )
    or (
      tipo_vinculo is distinct from 'diarista'
      and valor_diaria is null
      and salario_periodo is distinct from 'Diária'
    )
  );

alter table public.funcionarios
  drop constraint if exists funcionarios_tipo_vinculo_check;

alter table public.funcionarios
  add constraint funcionarios_tipo_vinculo_check
  check (tipo_vinculo in ('formal', 'informal', 'experiencia', 'diarista'));

-- Cadastro inicial unificado: ficha trabalhista completa para CLT e registro básico para diaristas.
-- A função grava o funcionário, eventual acesso ao portal e a linha do tempo na mesma transação.
create or replace function public.app_admin_cadastrar_funcionario_com_ficha(
  p_token text,
  p_dados jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v record;
  v_id uuid;
  v_user uuid;
  v_cpf text;
  v_tipo text;
  v_data_nascimento date;
  v_data_admissao date;
  v_salario numeric;
  v_salario_admissao numeric;
  v_valor_diaria numeric;
  v_salario_periodo text;
  v_liberar_acesso boolean;
  v_registrado boolean;
  v_soma integer;
  v_digito integer;
  v_i integer;
  v_empresa_razao_social text;
  v_empresa_cnpj text;
  v_cnpj_informado text;
begin
  if jsonb_typeof(p_dados) is distinct from 'object' then
    return jsonb_build_object('sucesso', false, 'erro', 'Dados do cadastro inválidos');
  end if;

  if not public.app_tem_permissao(p_token, 'employees.manage') then
    return jsonb_build_object('sucesso', false, 'erro', 'Acesso negado');
  end if;

  select * into v from public.app_tenant_usuario(p_token) limit 1;
  if v.usuario_id is null or v.empresa_id is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Sessão inválida');
  end if;

  v_liberar_acesso := coalesce(nullif(btrim(p_dados->>'liberar_acesso'), '')::boolean, false);
  if v_liberar_acesso and not public.app_tem_permissao(p_token, 'users.create') then
    return jsonb_build_object('sucesso', false, 'erro', 'Somente o administrador do sistema pode criar acesso de usuário');
  end if;

  if nullif(btrim(p_dados->>'nome'), '') is null then
    return jsonb_build_object('sucesso', false, 'erro', 'O nome é obrigatório');
  end if;

  v_cpf := regexp_replace(coalesce(p_dados->>'cpf', ''), '[^0-9]', '', 'g');
  if length(v_cpf) <> 11 or v_cpf ~ '^([0-9])\1{10}$' then
    return jsonb_build_object('sucesso', false, 'erro', 'Informe um CPF válido com 11 dígitos');
  end if;

  v_soma := 0;
  for v_i in 1..9 loop
    v_soma := v_soma + substr(v_cpf, v_i, 1)::integer * (11 - v_i);
  end loop;
  v_digito := (v_soma * 10) % 11;
  if v_digito = 10 then v_digito := 0; end if;
  if v_digito <> substr(v_cpf, 10, 1)::integer then
    return jsonb_build_object('sucesso', false, 'erro', 'Informe um CPF válido com 11 dígitos');
  end if;

  v_soma := 0;
  for v_i in 1..10 loop
    v_soma := v_soma + substr(v_cpf, v_i, 1)::integer * (12 - v_i);
  end loop;
  v_digito := (v_soma * 10) % 11;
  if v_digito = 10 then v_digito := 0; end if;
  if v_digito <> substr(v_cpf, 11, 1)::integer then
    return jsonb_build_object('sucesso', false, 'erro', 'Informe um CPF válido com 11 dígitos');
  end if;

  v_tipo := nullif(btrim(p_dados->>'tipo_vinculo'), '');
  if v_tipo is null or v_tipo not in ('formal', 'informal', 'experiencia', 'diarista') then
    return jsonb_build_object('sucesso', false, 'erro', 'Tipo de vínculo inválido');
  end if;

  v_data_nascimento := nullif(btrim(p_dados->>'data_nascimento'), '')::date;
  v_data_admissao := nullif(btrim(p_dados->>'data_admissao'), '')::date;
  v_salario := nullif(btrim(p_dados->>'salario'), '')::numeric;
  v_salario_admissao := nullif(btrim(p_dados->>'salario_admissao'), '')::numeric;
  v_valor_diaria := nullif(btrim(p_dados->>'valor_diaria'), '')::numeric;

  if coalesce(v_salario, 0) < 0 or coalesce(v_salario_admissao, 0) < 0 or coalesce(v_valor_diaria, 0) < 0 then
    return jsonb_build_object('sucesso', false, 'erro', 'Os valores de remuneração não podem ser negativos');
  end if;
  if coalesce(v_salario, 0) > 0 and coalesce(v_valor_diaria, 0) > 0 then
    return jsonb_build_object('sucesso', false, 'erro', 'Informe remuneração mensal ou diária, não ambas');
  end if;
  if coalesce(v_valor_diaria, 0) > 0 and v_tipo <> 'diarista' then
    return jsonb_build_object('sucesso', false, 'erro', 'Valor diário só pode ser informado para vínculo diarista');
  end if;
  if v_tipo = 'diarista' and (coalesce(v_salario, 0) > 0 or coalesce(v_salario_admissao, 0) > 0) then
    return jsonb_build_object('sucesso', false, 'erro', 'Vínculo diarista não pode receber salário mensal');
  end if;
  if v_tipo = 'formal' and (v_data_nascimento is null or v_data_admissao is null or coalesce(v_salario, 0) <= 0) then
    return jsonb_build_object('sucesso', false, 'erro', 'Para cadastro CLT, informe nascimento, admissão e salário mensal');
  end if;
  if v_liberar_acesso and v_data_nascimento is null then
    return jsonb_build_object('sucesso', false, 'erro', 'Informe a data de nascimento para criar o acesso');
  end if;

  -- O mesmo lock usado no cadastro legado evita colisões concorrentes por CPF.
  perform pg_advisory_xact_lock(20261101, hashtext(v_cpf));
  if exists (
    select 1 from public.funcionarios f
    where regexp_replace(f.cpf, '[^0-9]', '', 'g') = v_cpf
    limit 1
  ) then
    return jsonb_build_object('sucesso', false, 'erro', 'CPF já cadastrado');
  end if;

  select e.razao_social,
         regexp_replace(coalesce(e.cnpj, ''), '[^0-9]', '', 'g')
  into v_empresa_razao_social, v_empresa_cnpj
  from public.empresas e
  where e.id = v.empresa_id and e.ativo = true
  limit 1;
  if not found then
    return jsonb_build_object('sucesso', false, 'erro', 'Empresa não encontrada');
  end if;
  if length(coalesce(v_empresa_cnpj, '')) <> 14 then v_empresa_cnpj := null; end if;

  v_cnpj_informado := regexp_replace(
    coalesce(nullif(btrim(p_dados->>'empregador_cnpj'), ''), v_empresa_cnpj, ''),
    '[^0-9]', '', 'g'
  );
  if length(coalesce(v_cnpj_informado, '')) <> 14 then v_cnpj_informado := v_empresa_cnpj; end if;
  v_registrado := v_tipo = 'formal';
  if v_tipo = 'diarista' then
    v_salario := null;
    v_salario_admissao := null;
    v_salario_periodo := 'Diária';
    v_data_admissao := nullif(btrim(p_dados->>'data_admissao'), '')::date;
  else
    v_salario_periodo := coalesce(nullif(btrim(p_dados->>'salario_periodo'), ''), 'Mês');
    if v_registrado and v_salario_admissao is null then v_salario_admissao := v_salario; end if;
  end if;

  insert into public.funcionarios (
    empresa_id, empregador_razao_social, empregador_cnpj, empregador_endereco,
    nome, cpf, data_nascimento, local_nascimento, pais_nacionalidade, estado_civil,
    sexo, cor_raca, grau_instrucao, deficiencia, nome_pai, nome_mae,
    matricula_esocial, numero_registro, rg, rg_data_emissao, rg_orgao_emissor,
    titulo_eleitor, titulo_zona, titulo_secao, inscricao_orgao_classe, ctps,
    ctps_serie, ctps_data_expedicao, ctps_uf, cnh, cnh_categoria, doc_militar,
    doc_militar_categoria, endereco, cep, telefone_residencial, telefone_celular,
    cargo, funcao, cbo, data_admissao, salario, salario_periodo, salario_admissao,
    horario_trabalho, horario_intervalo, fgts_opcao, fgts_conta_banco,
    fgts_data_retificacao, pis_cadastro, pis_numero, banco_domicilio, banco_numero,
    banco_agencia, banco_endereco, alteracoes, ferias_periodo_aquisitivo,
    ferias_periodo_gozo, ferias_periodo_abono, observacoes, acidentes_doencas,
    contribuicao_sindical, beneficiarios, tipo_vinculo, registrado, valor_mensal,
    valor_diaria, elegivel_holerite, elegivel_escritorio, elegivel_vale, ativo,
    cadastro_tipo
  ) values (
    v.empresa_id,
    coalesce(nullif(btrim(p_dados->>'empregador_razao_social'), ''), v_empresa_razao_social),
    v_cnpj_informado,
    nullif(btrim(p_dados->>'empregador_endereco'), ''),
    btrim(p_dados->>'nome'), v_cpf, v_data_nascimento,
    nullif(btrim(p_dados->>'local_nascimento'), ''),
    coalesce(nullif(btrim(p_dados->>'pais_nacionalidade'), ''), 'BRASIL'),
    nullif(btrim(p_dados->>'estado_civil'), ''),
    nullif(btrim(p_dados->>'sexo'), ''), nullif(btrim(p_dados->>'cor_raca'), ''),
    nullif(btrim(p_dados->>'grau_instrucao'), ''), nullif(btrim(p_dados->>'deficiencia'), ''),
    nullif(btrim(p_dados->>'nome_pai'), ''), nullif(btrim(p_dados->>'nome_mae'), ''),
    nullif(btrim(p_dados->>'matricula_esocial'), ''), nullif(btrim(p_dados->>'numero_registro'), ''),
    nullif(btrim(p_dados->>'rg'), ''), nullif(btrim(p_dados->>'rg_data_emissao'), '')::date,
    nullif(btrim(p_dados->>'rg_orgao_emissor'), ''), nullif(btrim(p_dados->>'titulo_eleitor'), ''),
    nullif(btrim(p_dados->>'titulo_zona'), ''), nullif(btrim(p_dados->>'titulo_secao'), ''),
    nullif(btrim(p_dados->>'inscricao_orgao_classe'), ''), nullif(btrim(p_dados->>'ctps'), ''),
    nullif(btrim(p_dados->>'ctps_serie'), ''), nullif(btrim(p_dados->>'ctps_data_expedicao'), '')::date,
    nullif(btrim(p_dados->>'ctps_uf'), ''), nullif(btrim(p_dados->>'cnh'), ''),
    nullif(btrim(p_dados->>'cnh_categoria'), ''), nullif(btrim(p_dados->>'doc_militar'), ''),
    nullif(btrim(p_dados->>'doc_militar_categoria'), ''), nullif(btrim(p_dados->>'endereco'), ''),
    nullif(btrim(p_dados->>'cep'), ''), nullif(btrim(p_dados->>'telefone_residencial'), ''),
    nullif(btrim(p_dados->>'telefone_celular'), ''), nullif(btrim(p_dados->>'cargo'), ''),
    nullif(btrim(p_dados->>'funcao'), ''), nullif(btrim(p_dados->>'cbo'), ''), v_data_admissao,
    v_salario, v_salario_periodo, v_salario_admissao,
    nullif(btrim(p_dados->>'horario_trabalho'), ''), nullif(btrim(p_dados->>'horario_intervalo'), ''),
    nullif(btrim(p_dados->>'fgts_opcao'), '')::date, nullif(btrim(p_dados->>'fgts_conta_banco'), ''),
    nullif(btrim(p_dados->>'fgts_data_retificacao'), '')::date,
    nullif(btrim(p_dados->>'pis_cadastro'), '')::date, nullif(btrim(p_dados->>'pis_numero'), ''),
    nullif(btrim(p_dados->>'banco_domicilio'), ''), nullif(btrim(p_dados->>'banco_numero'), ''),
    nullif(btrim(p_dados->>'banco_agencia'), ''), nullif(btrim(p_dados->>'banco_endereco'), ''),
    nullif(btrim(p_dados->>'alteracoes'), ''), nullif(btrim(p_dados->>'ferias_periodo_aquisitivo'), ''),
    nullif(btrim(p_dados->>'ferias_periodo_gozo'), ''), nullif(btrim(p_dados->>'ferias_periodo_abono'), ''),
    nullif(btrim(p_dados->>'observacoes'), ''), nullif(btrim(p_dados->>'acidentes_doencas'), ''),
    nullif(btrim(p_dados->>'contribuicao_sindical'), ''), nullif(btrim(p_dados->>'beneficiarios'), ''),
    v_tipo, v_registrado, case when v_tipo = 'diarista' then null else v_salario end,
    case when v_tipo = 'diarista' then v_valor_diaria else null end,
    v_registrado, v_registrado, true, true,
    case when v_registrado then 'completo' else 'basico' end
  ) returning id into v_id;

  if v_liberar_acesso then
    insert into public.usuarios (
      empresa_id, cpf, senha_hash, funcionario_id, primeiro_acesso, ativo, perfil, nome_exibicao
    ) values (
      v.empresa_id, v_cpf, crypt(to_char(v_data_nascimento, 'DDMMYYYY'), gen_salt('bf')),
      v_id, true, true, 'funcionario', btrim(p_dados->>'nome')
    ) returning id into v_user;

    insert into public.app_user_roles(usuario_id, role_code, atribuido_por)
    values (v_user, 'funcionario', v.usuario_id)
    on conflict (usuario_id) do update
      set role_code = 'funcionario', atribuido_por = excluded.atribuido_por;
  end if;

  insert into public.funcionario_timeline(empresa_id, funcionario_id, evento, descricao, data_evento, origem, created_by)
  values (v.empresa_id, v_id, 'Cadastro criado', 'Funcionário cadastrado no sistema', current_date, 'cadastro', v.usuario_id);

  return jsonb_build_object('sucesso', true, 'funcionario_id', v_id, 'usuario_id', v_user);
exception
  when unique_violation then
    return jsonb_build_object('sucesso', false, 'erro', 'CPF já cadastrado');
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('sucesso', false, 'erro', 'Verifique o formato das datas e dos valores numéricos');
  when string_data_right_truncation then
    return jsonb_build_object('sucesso', false, 'erro', 'Um dos campos excede o limite de caracteres permitido');
end;
$$;

revoke all on function public.app_admin_cadastrar_funcionario_com_ficha(text, jsonb) from public;
grant execute on function public.app_admin_cadastrar_funcionario_com_ficha(text, jsonb) to anon, authenticated;
comment on function public.app_admin_cadastrar_funcionario_com_ficha(text, jsonb) is
  'Cadastra funcionário com escopo de tenant; para CLT grava a ficha completa e para diarista permite o cadastro básico com nome e CPF.';

commit;
