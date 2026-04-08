---
name: setup-pi
description: Guia completo para configurar um novo Raspberry Pi como relay de camera RTSP para o SkyLapse, incluindo Tailscale, go2rtc, Funnel e cadastro no portal.
---

# Setup de Novo Raspberry Pi — SkyLapse

Skill para configurar um Raspberry Pi novo como relay de camera RTSP no projeto SkyLapse.

## Arquitetura

```
[Camera RTSP] -> [Pi (go2rtc)] -> [Tailscale Funnel URL publica] -> [Servidor do Portal (HTTP GET /api/frame.jpeg)]
```

- O Pi repassa o stream RTSP via go2rtc e tambem gera snapshots JPEG sob demanda.
- O servidor do portal captura frames via HTTP GET no endpoint `/api/frame.jpeg` do go2rtc. NAO usa ffmpeg para captura.
- Snapshots usam o source `camera1_hd` (main stream) — URL: `https://<HOSTNAME>.taild2c22c.ts.net/api/frame.jpeg?src=camera1_hd`
- Live view usa `camera1` (sub-stream, 640x360) para economizar banda.

## Informacoes que DEVEM ser solicitadas ao usuario antes de comecar

Antes de iniciar o setup, SEMPRE perguntar ao usuario:
1. **IP do Pi na rede local** (ou hostname)
2. **Usuario e senha SSH do Pi** (cada Pi tem credenciais diferentes, por seguranca)
3. **IP da camera RTSP na rede local**
4. **Usuario e senha da camera**
5. **Marca da camera** (Reolink, Hikvision, Intelbras, etc.)
6. **Hostname desejado no Tailscale** (ex: obra-centro, obra-sul)

## Passo a Passo

### 1. Preparar o Pi (Raspberry Pi 4)

Conectar via SSH no Pi com as credenciais fornecidas pelo usuario:

```bash
ssh <USUARIO_SSH>@<IP_DO_PI>
```

Atualizar o sistema:

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Instalar Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=<AUTH_KEY>
```

- Gerar auth key em: https://login.tailscale.com/admin/settings/keys
- Usar auth key **reusable** e **ephemeral** para facilitar reinstalacoes.
- Verificar status: `tailscale status`

### 3. Definir hostname no Tailscale

```bash
sudo tailscale set --hostname=<NOME_DO_SITE>
```

Exemplo: `sudo tailscale set --hostname=obra-centro`

### 4. Instalar go2rtc (Raspberry Pi 4 — ARM64)

```bash
wget https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64
chmod +x go2rtc_linux_arm64
sudo mv go2rtc_linux_arm64 /usr/local/bin/go2rtc
```

### 5. Configurar go2rtc

Criar config:

```bash
sudo mkdir -p /etc/go2rtc
sudo nano /etc/go2rtc/go2rtc.yaml
```

Conteudo (ajustar IP, usuario, senha e paths RTSP da camera):

```yaml
streams:
  camera1: rtsp://<USUARIO>:<SENHA>@<IP_CAMERA>:554/<PATH_SUB_STREAM>
  camera1_hd: rtsp://<USUARIO>:<SENHA>@<IP_CAMERA>:554/<PATH_MAIN_STREAM>
```

Paths RTSP comuns por fabricante:

| Marca      | Sub-stream                    | Main stream                    |
|------------|-------------------------------|--------------------------------|
| Reolink    | h264Preview_01_sub            | h264Preview_01_main            |
| Hikvision  | Streaming/Channels/102        | Streaming/Channels/101         |
| Intelbras  | cam/realmonitor?channel=1&subtype=1 | cam/realmonitor?channel=1&subtype=0 |

### 6. Criar servico systemd para go2rtc

```bash
sudo tee /etc/systemd/system/go2rtc.service << 'EOF'
[Unit]
Description=go2rtc
After=network.target

[Service]
ExecStart=/usr/local/bin/go2rtc -config /etc/go2rtc/go2rtc.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable go2rtc
sudo systemctl start go2rtc
```

### 7. Habilitar Tailscale Funnel

```bash
sudo tailscale funnel --bg 1984
```

Isso expoe o go2rtc na URL publica: `https://<HOSTNAME>.taild2c22c.ts.net`

Verificar se o Funnel esta ativo:

```bash
tailscale funnel status
```

### 8. Verificar tudo

Testar do Pi:
```bash
curl -s http://localhost:1984/api/streams
```

Testar remotamente (do Mac ou servidor):
```bash
# Via Tailscale IP
curl -s http://<TAILSCALE_IP>:1984/api/streams

# Via Funnel (URL publica)
curl -s https://<HOSTNAME>.taild2c22c.ts.net/api/streams

# Testar snapshot (deve retornar imagem JPEG)
curl -s https://<HOSTNAME>.taild2c22c.ts.net/api/frame.jpeg?src=camera1_hd -o /tmp/test.jpg && ls -la /tmp/test.jpg
```

Deve retornar JSON com os streams `camera1` e `camera1_hd`.
O teste de snapshot deve gerar um arquivo JPEG de ~100-300KB.

### 9. Cadastrar no portal SkyLapse

No painel admin do portal:
1. Adicionar nova camera
2. **Stream URL**: `https://<HOSTNAME>.taild2c22c.ts.net`
3. **Intervalo de captura**: definir em minutos (ex: 5)
4. Testar conexao pelo botao do portal

## Troubleshooting

| Problema | Causa provavel | Solucao |
|----------|---------------|---------|
| `connection refused` na porta 554 | Camera desligada ou inicializando | Aguardar 1-2 min, verificar alimentacao |
| go2rtc retorna 5XX | Camera RTSP inacessivel | Verificar IP da camera, testar `ping <IP_CAMERA>` |
| Funnel nao responde | Funnel nao habilitado | Rodar `sudo tailscale funnel --bg 1984` |
| Pi reiniciando sozinho | Undervoltage / fonte fraca | Trocar fonte, verificar `dmesg | grep -i voltage` |
| Snapshot vazio | Stream nao iniciado | Acessar `http://localhost:1984` no browser do Pi |
| Camera instavel (liga/desliga) | Fonte subdimensionada, cabo ruim, superaquecimento | Verificar fonte PoE/12V, trocar cabo, ventilacao |

## Cameras ativas (referencia)

- **skyline-timelapse**: https://skyline-timelapse.taild2c22c.ts.net (Reolink, camera1/camera1_hd)
