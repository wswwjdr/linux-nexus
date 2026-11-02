# React 项目视频播放器迁移：时间轴调整与校验说明

日期：2026-11-02。读者：负责 React 目标项目的 AI Agent。

目标项目的视频播放器迁移自 Nexus 的 Vue + Video.js 播放器。迁移后需要核对并同步下述两个调整。本文提供独立的行为规范、配置、样式和验收方法，不要求访问源项目或沿用其组件命名、目录和测试命令。

## 1. 目标与迁移前检查

需要达到的行为：

1. 鼠标悬浮进度条时，气泡显示指向位置对应的时间，不应一直显示当前播放时间；悬浮本身不改变播放位置。
2. 进度条左侧显示当前播放时间，右侧继续显示剩余时间。

源项目通过 Video.js 初始化配置和组件局部 CSS 完成调整，没有新增计时器、接管进度条拖动或修改依赖源码。React 目标项目应复用相同的 Video.js 能力，按现有结构落地。

开始前，在目标项目确认：

- 播放器依赖及锁定版本。源项目核查的是 Video.js `8.23.7`，不代表目标项目也是此版本。
- React 播放器组件、Video.js 初始化位置、配置合并方式和样式入口。
- 是否自定义了控制栏 `children`，是否移除了当前时间、鼠标时间或剩余时间控件。
- 是否仍使用原生 Video.js 控制栏。如果迁移时已改成 React 自绘时间轴，下面的配置和类名不能直接套用，应在现有时间轴中实现相同行为。

本文未检查 React 目标项目代码。其文件位置、依赖版本、样式方案、启动方式和测试命令均须由目标 Agent 在仓库中查明。不要把源项目的验证结果当成目标项目已通过的证据。

## 2. 调整一：悬浮时间由鼠标位置驱动

### 原因与证据

在源项目核查的 Video.js 版本中，默认存在两种时间提示：

| 控件 | DOM | 时间来源 |
| --- | --- | --- |
| `PlayProgressBar` 的 `TimeTooltip` | `.vjs-play-progress .vjs-time-tooltip` | 当前播放位置 |
| `MouseTimeDisplay` 的 `TimeTooltip` | `.vjs-progress-control .vjs-mouse-display .vjs-time-tooltip` | 鼠标在轨道上的比例 × 视频总时长 |

默认皮肤会对 `.vjs-touch-enabled:not(.vjs-scrubbing)` 下的鼠标位置提示设置 `visibility: hidden`、`opacity: 0`。支持触摸的电脑也可能使用鼠标，此时用户可能只看到当前播放位置提示。

上述组件行为与 CSS 已通过源项目本地依赖源码确认，符合报告的现象。但未在用户设备采集实际类名和计算样式，不能将触摸隐藏规则视为所有目标环境问题的既定原因。目标 Agent 应在本项目依赖和浏览器中核实。

可在目标项目安装的 `video.js` 包中查找 `PlayProgressBar`、`MouseTimeDisplay`、`ProgressControl` 及默认皮肤的 `.vjs-mouse-display` 规则。包管理器布局和文件名可能随版本变化。

### Video.js 配置

将以下配置合入 React 组件现有的 `videojs(element, options)` 初始化选项：

```ts
controlBar: {
  progressControl: {
    seekBar: {
      playProgressBar: { children: [] },
    },
  },
},
```

`children: []` 只移除 `PlayProgressBar` 的子提示，保留已播放范围和播放头，继续使用原生 `MouseTimeDisplay` 计算悬浮时间。不要误放到 `controlBar.children` 或 `seekBar.children`，否则可能移除必要控件。

保留目标项目其他初始化选项，避免浅合并覆盖整个 `controlBar`。如果目标项目自定义了控件列表，确保 `MouseTimeDisplay` 存在且只有一个，不重复插入或通过 DOM 手工拼装气泡。

### React 中的样式

普通 CSS 示例；`.video-player` 是播放器外层容器的示例类名，应替换为目标项目实际作用域类，并确保实际 DOM 中存在该容器：

```css
@media (any-hover: hover) {
  .video-player .video-js:not(.vjs-user-inactive) .vjs-progress-control:hover .vjs-mouse-display {
    visibility: visible;
    opacity: 1;
    transition: none;
  }
}
```

`any-hover` 表示至少一个输入设备支持悬浮，使触摸与鼠标混合设备也能显示鼠标时间提示。选择器限定播放器活跃且指针悬浮在进度控件上；纯触摸设备不因这条规则获得常驻悬浮提示。

React 不能直接复制 Vue 的 `:deep(...)`。若采用 CSS Modules，应让本项目容器类保持局部作用域、Video.js 生成的类保持全局匹配。例如：

```css
@media (any-hover: hover) {
  .videoPlayer :global(.video-js:not(.vjs-user-inactive) .vjs-progress-control:hover .vjs-mouse-display) {
    visibility: visible;
    opacity: 1;
    transition: none;
  }
}
```

对应 JSX 容器使用 `className={styles.videoPlayer}`。其他样式方案按项目已有约定表达相同选择器，不另建样式体系。核对浏览器计算样式，确认规则能覆盖依赖皮肤且不影响其他播放器。

注意：音量控件也可能使用 `.vjs-mouse-display`。样式和 DOM 查询必须限定在 `.vjs-progress-control` 下。

## 3. 调整二：进度条左侧显示当前播放时间

源项目使用的默认 Video.js 控制栏已包含 `CurrentTimeDisplay`，位置在音量控件之后、进度控件之前，只是默认皮肤将其隐藏。

在目标播放器样式作用域内启用显示。普通 CSS 写法：

```css
.video-player .video-js:not(.vjs-live) .vjs-current-time {
  display: block;
}
```

CSS Modules 对应写法：

```css
.videoPlayer :global(.video-js:not(.vjs-live) .vjs-current-time) {
  display: block;
}
```

两者是不同样式方案的等价写法，按目标项目选择一套。`:not(.vjs-live)` 保留直播状态下原有的隐藏语义。

如果目标项目自定义控制栏并移除了 `CurrentTimeDisplay`，仅改 CSS 不够：须在其控制栏配置中恢复 `currentTimeDisplay`，放在 `progressControl` 之前，并保留其后的 `remainingTimeDisplay`。不要因此替换其他控件或照搬源项目完整控制栏列表。

普通文件视频的目标布局：

```text
播放按钮 → 音量 → 当前时间 → 进度条 → 剩余时间 → 倍速等控件
```

时间更新、格式化、拖动中的显示继续由 Video.js 负责，不新增 React 定时器或每帧 state 同步。无需额外显示总时长或时间分隔符。

### React 集成检查

- 将配置合入已有初始化流程，不因 render、进度更新或悬浮重建播放器。
- 检查 effect 初始化与清理在项目启用的 React StrictMode 下能正确重复执行，不重复注册控件或事件，不使用已销毁实例。
- 卸载、关闭预览时按既有生命周期释放实例；重新打开、切换视频源后，两个功能仍有效。
- 检查 CSS Modules 类名、CSS 层叠及弹窗/Portal 实际 DOM，确认作用域容器包住播放器且样式能覆盖默认皮肤。

