# GitHub Pages 上线说明

当前仓库建议使用 `docs/` 目录作为 GitHub Pages 发布源。

## 操作步骤

1. 在 GitHub 新建一个公开仓库，例如 `huojie-portfolio`。
2. 把本地 `C:\Users\zdr\Desktop\活结` 推送到这个仓库。
3. 打开仓库的 `Settings` -> `Pages`。
4. 在 `Build and deployment` 中选择 `Deploy from a branch`。
5. `Branch` 选择 `main`，文件夹选择 `/docs`，保存。
6. 等待 GitHub Pages 构建完成，访问页面给出的 `https://你的用户名.github.io/huojie-portfolio/`。

## 本地 Git 命令参考

```powershell
git init
git add docs .gitignore GITHUB_PAGES_DEPLOY.md
git commit -m "Add Huojie portfolio site for GitHub Pages"
git branch -M main
git remote add origin https://github.com/你的用户名/huojie-portfolio.git
git push -u origin main
```

如果还想把完整游戏源文件一起备份到 GitHub，再把 `index.html`、`css/`、`js/`、`assets/`、`www/` 等文件加入提交即可。不要提交 `node_modules/`、Android 构建缓存和 APK 文件。
