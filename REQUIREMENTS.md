# AIPet System Requirements & Setup Guide

To run, develop, or package the **AIPet** desktop application on a new machine, you need to satisfy the following toolchain and system requirements.

---

## 💻 System Prerequisites

### Windows
- **OS**: Windows 10 or 11 (64-bit).
- **Runtime**: [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 11).
- **C++ Build Tools**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (make sure "Desktop development with C++" workload is checked).

---

## 🛠️ Development Toolchain

### 1. Node.js & NPM
- **Node.js**: v18.0.0 or higher (LTS recommended).
- **NPM**: v9.0.0 or higher.
- Verify installation:
  ```bash
  node --version
  npm --version
  ```

### 2. Rust & Cargo
- **Rustup**: The official Rust toolchain installer (Rust version 1.75+ or higher stable).
- Verify installation:
  ```bash
  rustc --version
  cargo --version
  ```

### 3. NSIS (For Windows Installer packaging)
- **NSIS**: v3.0 or higher with `makensis.exe` added to your system `PATH` env variable.
- Verify installation:
  ```bash
  makensis /VERSION
  ```

---

## 🚀 Get Started

1. **Clone the repository**:
   ```bash
   git clone <your-github-repo-url>
   cd pet
   ```

2. **Install Frontend Dependencies**:
   ```bash
   npm install
   ```

3. **Run Dev Environment**:
   ```bash
   npm run dev
   # In another shell or via tauri CLI directly:
   npx tauri dev
   ```

4. **Build Production Packages (.exe & Installer)**:
   ```bash
   npm run tauri build
   ```
   The compiled direct-executable `.exe` and the `.exe` setup installer will be output to:
   ```text
   src-tauri/target/release/aipet-desktop-pet.exe
   src-tauri/target/release/bundle/nsis/AIPet_0.1.0_x64-setup.exe
   ```
