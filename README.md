# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

cd src-tauri
cargo update
cd ..
npm run tauri dev

npm run tauri build

## Windows notifications and media controls

The regular Tauri MSI/NSIS builds keep working as before. Reading Windows notifications requires a packaged app identity, so use the separate MSIX script for that capability. The script requires the Windows SDK (`MakeAppx.exe` and `SignTool.exe`) and a signing certificate installed in `Cert:\CurrentUser\My`.

The certificate subject passed as `Publisher` must exactly match the package signing certificate. The signing certificate must also be trusted on the machine where the MSIX is installed.

```powershell
.\src-tauri\scripts\package-msix.ps1 -Publisher "CN=Your Publisher" -CertificateThumbprint "YOUR_CERTIFICATE_THUMBPRINT"
```

The MSIX requests access to recent Windows notifications and global media sessions. Notification access still requires the user to approve Windows' permission prompt. Store distribution may require review for declared capabilities.