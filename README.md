# 慈溪麻将游戏服务器

支持多人联机对战的慈溪麻将游戏后端服务器。

## 功能特性

- 创建/加入房间
- 自定义房间号
- 实时游戏对战（Socket.io）
- 语音聊天支持（WebRTC信令）
- 完整的麻将游戏规则
  - 136张牌
  - 癞子规则
  - 胡牌判断（平胡、七小对、对对胡、十三不靠）
  - 吃碰杠操作
  - 流局判定（剩17张牌）
  - 连庄计分

## 部署到 Render

### 方法一：通过 GitHub 部署（推荐）

1. **创建 GitHub 仓库**
   - 访问 https://github.com/new
   - 仓库名称：`cixi-mahjong-server`
   - 选择 "Public" 或 "Private"
   - 点击 "Create repository"

2. **上传代码到 GitHub**
   ```bash
   # 在本地项目文件夹中执行
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/你的用户名/cixi-mahjong-server.git
   git push -u origin main