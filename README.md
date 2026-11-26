# OS Protegida - Projeto Integrado UNIFEOB

Protótipo acadêmico para gestão de ordens de serviço e controle de peças de uma atividade de assistência técnica de computadores e equipamentos periféricos.

**Aluno:** Cauã Wilian Pereira · **Matrícula:** 25000693  
**Curso:** Análise e Desenvolvimento de Sistemas
**Beneficiário:** 63.583.490 CAUA WILIAN PEREIRA · **CNPJ:** 63.583.490/0001-16  
**Módulo:** Software Corporativo · 4º trimestre de 2026
**Protótipo Figma:** [Clique aqui](https://www.figma.com/design/LFC0VulzkpmTwSA7rxTtG4/OS-Protegida-%E2%80%94-Projeto-Integrado-UNIFEOB?node-id=0-1&t=2JgrPHY4NIphmSU6-1)

## 1. Executar localmente

Requisito: Node.js **22.16.0 ou superior**. O projeto utiliza módulos nativos do Node.js (incluindo `node:sqlite`), portanto não precisa instalar dependências externas.

Windows: execute `Iniciar_No_Windows.bat` ou use o PowerShell:

```powershell
cd PI_OS_Protegida
node --version
npm start
```

Linux/macOS:

```bash
cd PI_OS_Protegida
node --version
npm start
```

Acesse `http://127.0.0.1:3000`. O banco SQLite e os dados fictícios são criados no primeiro início, em `db/os-protegida.sqlite`.

Para escolher outra porta:

```bash
PORT=3137 npm start
```

No PowerShell:

```powershell
$env:PORT=3137; npm start
```

O servidor, por padrão, escuta somente em `127.0.0.1`, isto é, apenas na própria máquina. Não exponha o serviço diretamente à internet.

## 2. Contas de demonstração

| Perfil | Usuário | Senha |
|---|---|---|
| Administrador | `admin` | `Admin@Demo2026!` |
| Técnico | `tecnico` | `Tecnico@Demo2026!` |
| Consulta | `consulta` | `Consulta@Demo2026!` |

Essas credenciais são públicas, fixas e destinadas exclusivamente à apresentação local. Não reutilize em qualquer ambiente real. Exclua o banco de demonstração antes de reiniciar para zerar os registros:

1. Encerre o servidor com `Ctrl+C`.
2. Exclua `db/os-protegida.sqlite`, `db/os-protegida.sqlite-wal` e `db/os-protegida.sqlite-shm`, se existirem.
3. Inicie novamente com `npm start`.

## 3. Funcionalidades implementadas

- Login com senha armazenada por scrypt e salt aleatório.
- Sessão aleatória de 256 bits; apenas o hash do token é armazenado no SQLite.
- Cookie `HttpOnly`, `SameSite=Strict`, expiração de oito horas e revogação no logout.
- Limite de cinco tentativas inválidas por IP em 15 minutos (memória do processo).
- Perfis RBAC verificados no servidor: ADMIN, TECNICO e CONSULTA.
- Cadastro e consulta de clientes com dados mínimos.
- Abertura e consulta de ordens de serviço.
- Transições de status validadas no servidor; conclusão exige solução registrada.
- Cadastro de peças e entrada de estoque pelo Administrador.
- Saída de peças pelo Administrador ou Técnico, somente em ordem em execução, com transação e vínculo à OS.
- Impedimento de saldo negativo por validação e restrição no banco.
- Auditoria de autenticação, falhas de autorização, clientes, ordens, estoque e usuários.
- Gatilhos SQLite bloqueiam UPDATE e DELETE em `audit_logs` dentro do banco do protótipo.

## 4. Roteiro rápido de demonstração

1. Entre como `admin` e mostre o painel e o alerta de estoque mínimo.
2. Abra `Ordens de serviço` e localize a OS `OS-2026-002`, que inicia em execução.
3. Clique em **Peça**, informe o ID `1` (SSD SATA 480 GB) e quantidade `1`.
4. Mostre que o saldo do SSD cai de 6 para 5 e que a saída fica vinculada à ordem.
5. Altere o status da OS para concluída e informe uma solução com pelo menos dez caracteres.
6. Mostre a tela **Auditoria** para verificar os eventos.
7. Saia e entre como `consulta`; tente cadastrar um cliente. O servidor deve responder com acesso negado.
8. Entre como `tecnico`; a consulta e atendimento são permitidos, mas criar peça/entrada de estoque é bloqueado.

## 5. API principal

- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/dashboard`
- `GET/POST /api/clients`
- `GET/POST /api/orders`
- `PATCH /api/orders/:id/status`
- `POST /api/orders/:id/parts`
- `GET/POST /api/parts`
- `POST /api/stock/entry`
- `GET/POST /api/users` (ADMIN)
- `GET /api/audit` (ADMIN)

As requisições de alteração precisam ser da mesma origem quando o cabeçalho `Origin` estiver presente. A aplicação não habilita CORS.

## 6. Limites importantes - não é produção

Este é um protótipo acadêmico, local, com dados fictícios. Antes de qualquer uso com clientes reais, é necessário, no mínimo:

- Hospedagem e acesso apenas por HTTPS; em produção, definir `NODE_ENV=production` para ativar o atributo `Secure` do cookie.
- Trocar as contas e senhas de demonstração, implantar MFA e recuperação segura de senha.
- Criptografar o armazenamento e os backups; o arquivo SQLite local não é criptografado em repouso.
- Configurar backup automático, cópia externa/offline e testes de restauração.
- Proteger logs externamente; os gatilhos locais não impedem adulteração por alguém com controle direto do arquivo/host.
- Rever a base legal, finalidades, aviso de privacidade, prazo de retenção e fluxo dos direitos dos titulares conforme LGPD.
- Executar revisão de código, testes de segurança independentes e adequação de infraestrutura.
- Considerar PostgreSQL e controles operacionais adicionais para concorrência, disponibilidade e crescimento.

Não armazene senhas de Windows, BIOS, e-mail, contas ou outros segredos dos equipamentos dentro da OS. Se um procedimento exigir credencial, prefira acompanhamento presencial e acesso temporário, sem registrar a senha.

## 7. Documentos incluídos

Na pasta `docs/` estão as versões editáveis e/ou para leitura dos materiais:

- `Relatorio_Tecnico_PI_OS_Protegida.docx` e `.pdf` - relatório técnico completo.
- `Declaracao_de_Participacao_UNIFEOB.docx` e `.pdf` - declaração preenchida, com assinatura ainda pendente.
- `Relatorio_Final_Atividades_Extensao.docx` e `.pdf` - conteúdo organizado para transcrição no formulário oficial da Intranet; não substitui o formulário.
- `Roteiro_Video_PI_OS_Protegida.docx` e `.pdf` - roteiro para gravação de aproximadamente 8min45s.
- `Apresentacao_PI_OS_Protegida.pptx` e `.pdf` - apresentação de oito slides.
- `Checklist_Entrega_PI.md` - pendências acadêmicas e documentais.

**O vídeo não está gravado neste pacote.** Grave sua própria apresentação, com sua narração e demonstração, respeitando o limite de 10 minutos. Antes da entrega, valide o fluxo e as hipóteses com o beneficiário, confira o endereço no comprovante oficial da Receita Federal, assine a declaração e anexe o comprovante atualizado do CNPJ.

## 8. Estrutura do pacote

```text
PI_OS_Protegida/
├── server.js
├── package.json
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── assets/
│   ├── fluxo.png
│   ├── arquitetura.png
│   └── erd.png
```
