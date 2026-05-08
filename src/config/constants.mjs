import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "../..");

export const MOBILE_WECHAT_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.34(0x1800222b) NetType/WIFI Language/zh_CN";

export const DEFAULT_OUTPUT_DIR = process.env.WECHAT_ARTICLE_DATA_DIR
    ? path.resolve(process.env.WECHAT_ARTICLE_DATA_DIR)
    : path.resolve(PROJECT_ROOT, "wechat_articles_puppeteer");

export const INDEX_FILE_NAME = "articles.jsonl";

export const STOCK_TRACKING_DIR = process.env.STOCK_TRACKING_DATA_DIR
    ? path.resolve(process.env.STOCK_TRACKING_DATA_DIR)
    : path.resolve(PROJECT_ROOT, "stock_tracking");

export const STOP_WORDS = new Set([
    "今天",
    "这个",
    "因为",
    "所以",
    "已经",
    "还是",
    "一个",
    "没有",
    "不会",
    "就是",
    "我们",
    "你们",
    "他们",
    "自己",
    "如果",
    "然后",
    "而且",
    "以及",
    "进行",
    "可以",
    "需要",
    "什么",
    "不是",
    "时候",
    "里面",
    "这种",
    "比较",
    "一些",
]);

export const POSITIVE_HINTS = ["看多", "反弹", "乐观", "修复", "走强", "改善", "买入", "上涨", "机会"];
export const NEGATIVE_HINTS = ["看空", "回避", "风险", "杀跌", "悲观", "下跌", "卖出", "担忧", "避险"];
