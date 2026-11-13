# 海关行政处罚风险看板

完整程序流程、分类规则、异常处理、断点及邮件通知请看项目根目录的 [README.md](../../README.md)。本文只说明看板入口。

## 更新本地数据

先保存案例库，再在CMD运行：

```cmd
cd /d "D:\钟家如\luxcode\a.data analysis"
.\.venv\Scripts\python.exe .\customs-case-dashboard\build_site_data.py
```

该命令读取正式案例库、公司产品清单、同行配置和关注企业名单，生成 `dist/data/cases.json` 与 `cases-inline.js`。不重新OCR，也不自动提交GitHub。

## 打开看板

双击 `dist/index.html` 可本地直开。也可在分析目录运行：

```cmd
.\.venv\Scripts\python.exe -m http.server 8774 --bind 127.0.0.1 --directory ".\customs-case-dashboard\dist"
```

打开 <http://127.0.0.1:8774/>，窗口保持运行；更新后按Ctrl＋F5。该地址只用于本机。

## 数据与点击口径

- 一案多行为以“一级|二级”分类对子对应；各类型之间允许重叠。TOP5标签占比以全部当前筛选案件为分母。
- 金额在案例库按人民币元保存，看板展示万元；处罚合计为罚款加追缴。
- “公司产品关联”默认仍展示产品风险。点击展开区的 **COMPANY** 图标才进入关注企业报告。
- 关注企业在案例库“关注企业”Sheet的A/B列维护，**D2为所有企业共用的总收件邮箱**。SMTP由本机配置；静态网页不能自行发送邮件。
- 收缴清单及构建脚本排除的分类待复核记录不计入看板。

## 发布

上传 **dist中的全部文件**，保留data子目录及脚本、样式的配套版本。GitHub Pages的具体发布方式以远程仓库配置为准，不能假定已自动配置Actions。发件凭据、案例库和OCR档案均不放入dist。

发布数据采用紧凑JSON；搜索索引在浏览器恢复，以减少重复体积。案件业务字段未因此删减。图表库当前来自外部ECharts脚本，完全离线使用需另行准备图表资源。
