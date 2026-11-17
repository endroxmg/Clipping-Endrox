# Run Endrox on an Oracle Always Free VM

Endrox's existing Docker Compose stack runs the app, PostgreSQL and Caddy on a single VM. Keep the VM within Oracle's Always Free allowance. In the Oracle console, create an Ubuntu Arm VM using the `VM.Standard.A1.Flex` shape with 2 OCPUs and 12 GB RAM, and an Always Free boot volume. Give it a public IPv4 address. Allow inbound TCP 22, 80 and 443 in its VCN security rules. SSH access uses the key Oracle gives you at VM creation. Oracle may report that free capacity is unavailable in a region.

On the VM, [install Docker Engine and the Compose plugin for Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Then run:

```sh
git clone https://github.com/endroxmg/Clipping-Endrox.git
cd Clipping-Endrox
python3 deploy/oracle/setup_env.py YOUR_VM_PUBLIC_IPV4
docker compose up -d --build
```

The setup tool creates a private `.env` with a random database password and an `sslip.io` hostname derived from the VM's address. Caddy obtains the HTTPS certificate once the hostname resolves and ports 80 and 443 are reachable. Check `https://YOUR-ADDRESS.sslip.io/healthz` for `{"ok":true}`. The first launch downloads a speech model and may take several minutes.

Open the Endrox server, create your account, then grant it administrator access on the VM:

```sh
docker compose exec app python -m studio.admin grant YOUR_EMAIL
```

Enter your AI provider key in **Settings → AI & API key**. Friends can create their own Endrox logins. Their video files and clips live on the VM. For link imports, some video providers may refuse requests from cloud server addresses.

In Vercel, set `ENDROX_STUDIO_URL` to the new `https://...sslip.io` origin for Production and redeploy the connected GitHub project. The Vercel entry page will then open this server by default. Its **Connect workspace** control can also save the address per browser while the default is being updated.

Keep backups of the Docker `data` and `pgdata` volumes. If the VM is deleted, its data may be lost. The VM's public IP can change when the VM is replaced, which requires a new `.env` hostname and a Vercel setting update.
