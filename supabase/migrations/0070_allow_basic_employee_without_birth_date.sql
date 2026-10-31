begin;

-- Cadastros básicos podem ser criados com nome e CPF enquanto a documentação
-- complementar, incluindo a data de nascimento, ainda não foi entregue.
alter table public.funcionarios
  alter column data_nascimento drop not null;

commit;
