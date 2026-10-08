# Changelog

本项目所有重要改动记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [1.2.0] - 2026-10-08

### 新增
- **服务端预检验证按钮**(仅开发模式):写卡面板新增"验证"按钮,调用 `POST /api/validate` 对当前导出的 PNG 做服务端同规则预检(240×416 纯三色,不写卡、不占写卡锁);通过 `import.meta.env.DEV` 控制,`npm run build` 产物中不包含该按钮;按钮独立成行,仅需已生成导出 Blob 即可点击,不依赖读卡器状态
- **旋转角度功能**:属性面板新增角度输入框;`emitSel` 上报归一化 0~360 的角度(单选=绝对角度,多选=组合体相对角度);拖动旋转柄时经 `object:rotating` 实时回显;`applyProps` 使用 `rotateAroundCenter` 绕中心旋转;多选组角度只设在组合体上,取消选中由 Fabric `exitGroup` 自动传播给子对象,不存储相对角度
- **线条模式面板**:直线/画笔工具激活或选中 `line`/`path` 对象时,面板只显示"线条颜色 + 线宽"(不显示填充色/描边色);线条调色板不含"无"选项,从图形模式带入的"无描边"自动回退为黑色
- **Ctrl+Z 撤销 / Ctrl+Y、Ctrl+Shift+Z 重做**:快照式双栈(`canvas.toJSON()`),历史上限 50 步、状态去重;批量操作用 `batching` 标志合并记录;绘制中抑制快照;文字编辑中不拦截快捷键
- **多选操作**:Ctrl/Shift+点按多选(Fabric `selectionKey: ["ctrlKey","shiftKey"]`);多选时属性面板切换为图形模式,属性逐个下发到子对象

### 修复
- **多选旋转改写字号**:选中含文字的组合体旋转时,文字字号被属性面板残留值覆盖——`applyProps` 多选分支现对文字子对象只应用 `fill`,跳过 `fontSize`
- **多选旋转文字变粗**:多选分支曾把描边色/线宽也写给文字子对象,Fabric 沿字形轮廓描边导致笔画变粗——文字子对象现跳过 `stroke`/`strokeWidth`;App.vue 的 watch 按选中类型构造最小属性载荷(文字只传 fill/fontSize,直线/路径只传 stroke/strokeWidth,不交叉污染)
- **旋转逐帧污染撤销栈**:拖动旋转柄每帧都压入快照——新增 `rotatingNow` 标志,拖拽期间跳过 `saveState`,由 `object:modified` 统一记录一步
- **导出锯齿感强**:`exportCanvas` 由 1x 直接栅格化改为 **4x 超采样**(960×1664),再由管线以 `imageSmoothingQuality: high` 降采样回 240×416;降采样灰度边缘等价亚像素抗锯齿,显著减轻二值化锯齿;预览仍为像素级放大,与上机效果一致
- **字号跟随回归**:`emitSel` 对文字对象恢复上报 `fontSize`,拖角缩放后输入框同步折算值

### 变更
- 属性面板文字/图形/线条三模式切换(`isTextMode` / `isLineMode`);文字模式只应用 fill/fontSize,忽略描边线宽
- `emitSel` 对多选组只报 `{type, isMulti}`(避免多选组无意义的具体属性)

[Unreleased]: https://github.com/bluetag-web/bluetag-designer/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/bluetag-web/bluetag-designer/compare/v1.0.0...v1.2.0
