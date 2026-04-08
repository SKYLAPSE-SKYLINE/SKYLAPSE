---
title: Portal do Cliente — Completo
---
# Portal do Cliente — Completo

## What & Why

Construir o portal completo para contas de clientes. Hoje o dashboard do cliente é um placeholder sem funcionalidade real. O objetivo é entregar uma interface read-only onde o cliente veja apenas as câmeras que o admin liberou para ele, com o status de cada câmera e a galeria de capturas com filtro de data.

## Done looks like

- Cliente faz login e cai num dashboard com cards de câmeras (somente as liberadas pelo admin)
- Cada card mostra: nome da câmera, localidade, badge Online/Offline e horário da última captura
- Clicando num card, abre a galeria de fotos daquela câmera com filtro de data (início e fim)
- Snapshots ao vivo disponíveis via botão em cada card (carrega foto atual da câmera em tempo real)
- Nenhum botão de editar, apagar ou configurar aparece em qualquer lugar do portal
- Um cliente nunca enxerga câmeras ou dados de outro cliente (controle de acesso por JWT + tabela client_camera_access)
- Não há opção de deletar conta, trocar senha ou gerenciar nada — portal é 100% visualização

## Out of scope

- Geração de time-lapses (ainda não implementado no sistema)
- Streaming de vídeo ao vivo (somente snapshots JPEG estáticos)
- Troca de senha ou gerenciamento de conta pelo cliente
- Notificações ou alertas

## Tasks

1. **Endpoints de câmeras para o cliente** — Criar `GET /api/client/cameras` (lista somente câmeras autorizadas, DTO seguro sem credenciais), `GET /api/client/cameras/:id/snapshot` (imagem ao vivo, verifica acesso), e `GET /api/client/cameras/:id/captures` (lista capturas com filtro `dataInicio`/`dataFim`, verifica acesso). Todos protegidos por `isClientAuthenticated` e com verificação de acesso contra a tabela `client_camera_access`.

2. **Dashboard do cliente — lista de câmeras** — Reescrever `client/src/pages/cliente/dashboard.tsx` com cards de câmera mostrando nome, localidade, badge Online/Offline, horário da última captura e um botão de snapshot ao vivo. Header com logo SKYLAPSE, nome do cliente e botão Sair.

3. **Galeria de capturas do cliente** — Criar `client/src/pages/cliente/camera-captures.tsx` com grid de fotos capturadas, filtro por data (início e fim), lightbox para ampliar imagem individual e navegação anterior/próxima. Acessível via rota `/cliente/cameras/:id/capturas`. Registrar a rota em `App.tsx`.

## Relevant files

- `server/routes.ts`
- `server/storage.ts`
- `client/src/pages/cliente/dashboard.tsx`
- `client/src/App.tsx`
- `client/src/pages/admin/camera-gallery.tsx`
- `shared/schema.ts`