"""将案例库中允许公开展示的字段转换为静态看板数据。

原文附件暂不复制或上传；之后接入时，仅需为对应案件补充 originalUrl 与 ocrText。
"""

from __future__ import annotations

import json
import math
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd


PROJECT_DIR = Path(__file__).resolve().parent
sys.path.insert(0,str(PROJECT_DIR.parent))
from customs_parent_mapping import parent_customs_for
WORKBOOK = PROJECT_DIR.parent / "海关行政处罚案例库.xlsx"
COMPANY_PRODUCTS_WORKBOOK = PROJECT_DIR.parent / "公司产品.xlsx"
COMPANY_PRODUCT_SCOPE = PROJECT_DIR / "company_product_scope.json"
COMPANY_PRODUCT_EXPERIENCE = PROJECT_DIR / "company_product_match_experience.json"
PEER_COMPANIES = PROJECT_DIR / "peer_companies.json"
OUTPUT = PROJECT_DIR / "dist" / "data" / "cases.json"
INLINE_OUTPUT = PROJECT_DIR / "dist" / "data" / "cases-inline.js"


def text(value: object) -> str:
    if value is None or value is pd.NaT or value is pd.NA or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip()


def date_text(value: object) -> str:
    if value is None or value is pd.NaT or value is pd.NA or (isinstance(value, float) and math.isnan(value)):
        return ""
    try:
        parsed = pd.to_datetime(value, errors="raise")
        if pd.isna(parsed):
            return ""
        return parsed.strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return text(value)


def number(value: object) -> float | None:
    parsed = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(parsed) else float(parsed)


def code_text(value: object) -> str:
    value = text(value)
    return value[:-2] if value.endswith(".0") else value


def value(row: pd.Series, column: str) -> object:
    return row[column] if column in row else ""


def first_value(row: pd.Series, *columns: str) -> object:
    """按顺序读取第一个已填写的兼容字段。"""
    for column in columns:
        candidate = value(row, column)
        if text(candidate):
            return candidate
    return ""


def type_list(value: object) -> list[str]:
    """支持在“违法行为一级分类”中以中文或英文分隔符填写多项违规。"""
    values = [item.strip() for item in re.split(r"[、,，;；]+", text(value)) if item.strip()]
    return list(dict.fromkeys(values)) or ["未分类"]


def classification_pairs(row: pd.Series) -> list[dict[str, str]]:
    """读取权威的“一级|二级”分类对子，并兼容旧案例库并行字段。"""
    pairs: list[tuple[str, str]] = []
    raw_pairs = text(value(row, "违法行为分类对子"))
    for item in re.split(r"[;；]+", raw_pairs):
        if "|" not in item:
            continue
        primary, secondary = (part.strip() for part in item.split("|", 1))
        if primary and secondary:
            pairs.append((primary, secondary))
    if not pairs:
        primaries = type_list(value(row, "违法行为一级分类"))
        secondaries = [item.strip() for item in re.split(r"[;；]+", text(value(row, "违法行为二级分类"))) if item.strip()]
        if len(primaries) == len(secondaries):
            pairs = list(zip(primaries, secondaries))
        else:
            pairs = [(primary, "") for primary in primaries if primary != "未分类"]
    return [
        {"primary": primary, "secondary": secondary}
        for primary, secondary in dict.fromkeys(pairs)
    ]


def hs_codes(value: object) -> list[str]:
    """拆分并规范 HS 编码，只保留数字以兼容 6、8、10 位写法。"""
    return list(
        dict.fromkeys(
            code
            for item in re.split(r"[、,，;；\s]+", code_text(value))
            if (code := re.sub(r"\D", "", item))
        )
    )


def is_hidden_seizure_notice(row: pd.Series) -> bool:
    """收缴清单只在案例库保存，不进入任何HTML数据、统计或导出。"""
    # 与其余看板一致：分类对子是权威字段，只有缺失时才用并行一级字段兜兼容。
    return any(pair['primary']=='收缴清单' for pair in classification_pairs(row))


def normalize_product_name(value: object) -> str:
    """用于同类产品比对的名称标准化，不改变展示给用户的原始名称。"""
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]", "", text(value).lower())


def product_name_index(product_names: list[str]) -> dict[str, set[str]]:
    """以连续两字建立索引，避免逐案与全部产品名称进行模糊比较。"""
    index: dict[str, set[str]] = {}
    for product_name in product_names:
        normalized = normalize_product_name(product_name)
        for offset in range(len(normalized) - 1):
            index.setdefault(normalized[offset:offset + 2], set()).add(product_name)
    return index


def product_phrases(value: str) -> list[str]:
    """将商品描述拆为短语，避免用整段违法事实作模糊匹配而产生误报。"""
    phrases = [
        normalize_product_name(item)
        for item in re.split(r"[、,，;；/\\\n]+", value)
    ]
    return [phrase[:120] for phrase in phrases if len(phrase) >= 2]


def load_company_product_scope() -> tuple[list[str], list[str]]:
    if not COMPANY_PRODUCT_SCOPE.exists():
        raise FileNotFoundError(f"找不到公司产品范围规则：{COMPANY_PRODUCT_SCOPE}")
    scope = json.loads(COMPANY_PRODUCT_SCOPE.read_text(encoding="utf-8"))
    include = [normalize_product_name(value) for value in scope.get("includeKeywords", [])]
    exclude = [normalize_product_name(value) for value in scope.get("excludeKeywords", [])]
    if not include:
        raise ValueError("公司产品范围规则缺少 includeKeywords")
    return include, exclude


def load_company_product_exclusions() -> list[tuple[list[str], str]]:
    """读取经人工确认的公司产品误匹配经验，优先于 HS 和名称匹配。"""
    if not COMPANY_PRODUCT_EXPERIENCE.exists():
        return []
    payload = json.loads(COMPANY_PRODUCT_EXPERIENCE.read_text(encoding="utf-8"))
    rules: list[tuple[list[str], str]] = []
    for rule in payload.get("excludeRules", []):
        if not isinstance(rule, dict):
            continue
        keywords = [normalize_product_name(value) for value in rule.get("keywords", [])]
        keywords = [value for value in keywords if value]
        if keywords:
            rules.append((keywords, text(rule.get("reason"))))
    return rules


def product_is_in_company_scope(name: object, include: list[str], exclude: list[str]) -> bool:
    normalized_name = normalize_product_name(name)
    return (
        bool(normalized_name)
        and any(keyword in normalized_name for keyword in include)
        and not any(keyword in normalized_name for keyword in exclude)
    )


def load_company_products() -> tuple[list[str], list[str], dict[str, set[str]]]:
    """读取同级目录的公司产品清单，作为公司产品看板的匹配范围。"""
    if not COMPANY_PRODUCTS_WORKBOOK.exists():
        raise FileNotFoundError(f"找不到公司产品清单：{COMPANY_PRODUCTS_WORKBOOK}")

    products = pd.read_excel(COMPANY_PRODUCTS_WORKBOOK, dtype=str)
    headers = {re.sub(r"\s+", "", str(name)): name for name in products.columns}
    code_column = headers.get("商品编码")
    name_column = headers.get("商品名称")
    if not code_column or not name_column:
        raise ValueError("公司产品.xlsx 必须包含“商品编码”和“商品名称”两列")

    include, exclude = load_company_product_scope()
    scoped_products = products[
        products[name_column].apply(lambda item: product_is_in_company_scope(item, include, exclude))
    ]
    product_codes = list(
        dict.fromkeys(code for value in scoped_products[code_column] for code in hs_codes(value))
    )
    product_names = list(
        dict.fromkeys(text(value) for value in scoped_products[name_column] if text(value))
    )
    return product_codes, product_names, product_name_index(product_names)


def load_peer_companies() -> dict[str, list[str]]:
    """读取同行企业主体及别名，供同行风险信号统计使用。"""
    if not PEER_COMPANIES.exists():
        return {}
    payload = json.loads(PEER_COMPANIES.read_text(encoding="utf-8"))
    groups = payload.get("groups", {})
    if not isinstance(groups, dict):
        raise ValueError("同行企业主体库 groups 必须是对象")
    return {
        text(group): [text(name) for name in names if text(name)]
        for group, names in groups.items()
        if text(group) and isinstance(names, list)
    }


def peer_company_matches(party: str, peer_groups: dict[str, list[str]]) -> list[str]:
    """以企业主体名称及别名匹配当事人，返回命中的同行集团。"""
    return [
        group
        for group, aliases in peer_groups.items()
        if any(alias in party for alias in aliases)
    ]


def company_product_matches(
    declared_code: str,
    actual_code: str,
    match_text: str,
    product_codes: list[str],
    product_names: list[str],
    product_index: dict[str, set[str]],
    exclusion_rules: list[tuple[list[str], str]],
) -> tuple[bool, list[str]]:
    """HS 前 10 位及同类产品名称匹配，返回可审计的匹配依据。

    申报、实际商品编号同时存在时，以实际商品编号为准；仅有一个时使用该编码。
    """
    normalized_match_text = normalize_product_name(match_text)
    for keywords, _reason in exclusion_rules:
        if any(keyword in normalized_match_text for keyword in keywords):
            return False, []

    declared_codes = hs_codes(declared_code)
    actual_codes = hs_codes(actual_code)
    case_codes = actual_codes if actual_codes else declared_codes
    matched_codes = [
        product_code
        for product_code in product_codes
        if any(
            len(case_code) >= 10
            and len(product_code) >= 10
            and case_code[:10] == product_code[:10]
            for case_code in case_codes
        )
    ]

    phrases = product_phrases(match_text)
    normalized_text = " ".join(phrases)
    candidate_names: set[str] = set()
    for phrase in phrases:
        for offset in range(len(phrase) - 1):
            candidate_names.update(product_index.get(phrase[offset:offset + 2], set()))

    matched_names: list[str] = []
    for product_name in candidate_names:
        normalized_name = normalize_product_name(product_name)
        if len(normalized_name) < 2:
            continue
        if normalized_name in normalized_text:
            matched_names.append(product_name)
            continue

        # 对“无线充电线圈／充电线圈”“铝合金型材／铝型材”等带规格、
        # 用途或材质修饰的同类名称，使用高相似度加连续核心词双重校验。
        if len(normalized_name) >= 4:
            for phrase in phrases:
                matcher = SequenceMatcher(None, normalized_name, phrase, autojunk=False)
                similarity = matcher.ratio()
                longest_common = max((block.size for block in matcher.get_matching_blocks()), default=0)
                if similarity >= 0.62 and longest_common >= 3:
                    matched_names.append(product_name)
                    break

    matches = [
        *(f"HS 前10位（{'实际商品编号' if actual_codes else '申报商品编号'}）：{code[:10]}" for code in list(dict.fromkeys(matched_codes))[:3]),
        *(f"同类产品：{name}" for name in list(dict.fromkeys(matched_names))[:3]),
    ]
    return bool(matches), matches


def fine_rate(
    fine: float | None,
    amount: float | None,
    illegal_operation_amount: float | None,
    tax_underpayment_amount: float | None,
    types: list[str],
) -> tuple[float | None, str]:
    """按税款、出口管制、涉案金额的优先级计算处罚幅度。"""
    if fine is None:
        return None, ""
    if tax_underpayment_amount is not None:
        return (fine / tax_underpayment_amount, "漏缴税金额") if tax_underpayment_amount > 0 else (None, "漏缴税金额")
    if "出口管制" in types:
        return (fine / illegal_operation_amount, "违法经营额") if illegal_operation_amount and illegal_operation_amount > 0 else (None, "违法经营额")
    return (fine / amount, "涉案金额") if amount and amount > 0 else (None, "")


def main() -> None:
    if not WORKBOOK.exists():
        raise FileNotFoundError(f"找不到案例库：{WORKBOOK}")

    frame = pd.read_excel(WORKBOOK, sheet_name="案件信息")
    product_codes, product_names, product_index = load_company_products()
    exclusion_rules = load_company_product_exclusions()
    peer_groups = load_peer_companies()
    cases: list[dict[str, object]] = []
    excluded_seizure_notices = 0
    unmapped_customs: set[str] = set()

    for _, row in frame.iterrows():
        if is_hidden_seizure_notice(row):
            excluded_seizure_notices += 1
            continue
        review_status = text(value(row, "AI复核状态"))
        if review_status.startswith("待人工复核：分类未匹配"):
            # 无可靠分类落点的案件保留在案例库与复核清单中，不以“未分类”进入看板统计。
            continue
        case_id = text(value(row, "案件ID"))
        if not case_id:
            continue

        amount = number(value(row, "涉案金额"))
        illegal_operation_amount = number(value(row, "违法经营额"))
        tax_underpayment_amount = number(value(row, "漏缴税款"))
        recovery_amount = number(first_value(row, "追缴金额", "追缴金额（元）"))
        fine = number(value(row, "罚款金额"))
        penalty_amount = None if fine is None and recovery_amount is None else round((fine or 0) + (recovery_amount or 0), 2)
        pairs = classification_pairs(row)
        types = list(dict.fromkeys(pair["primary"] for pair in pairs)) or ["未分类"]
        rate, rate_basis = fine_rate(fine, amount, illegal_operation_amount, tax_underpayment_amount, types)
        reason = "；".join(pair["secondary"] for pair in pairs if pair["secondary"]) or text(value(row, "违法行为二级分类"))
        law_inspection_object = text(first_value(row, "检验检疫对象", "法检对象"))
        secondary_item = text(value(row, "涉案物项二级分类"))
        facts = text(value(row, "违法事实"))
        party = text(value(row, "当事人"))
        cargo = text(value(row, "涉案货物"))
        declared_code = code_text(value(row, "申报商品编号"))
        actual_code = code_text(value(row, "实际商品编号"))
        product_match_text = " ".join(
            (
                cargo,
                text(value(row, "申报情况")),
                text(value(row, "实际情况")),
            )
        )
        is_company_product, product_matches = company_product_matches(
            declared_code,
            actual_code,
            product_match_text,
            product_codes,
            product_names,
            product_index,
            exclusion_rules,
        )
        peer_matches = peer_company_matches(party, peer_groups)

        customs = text(value(row, "处罚海关"))
        direct_customs = text(value(row, "直属海关")) or text(value(row, "上级海关")) or parent_customs_for(customs)
        parent_customs = direct_customs
        if customs and not direct_customs:
            unmapped_customs.add(customs)

        record = {
            "id": case_id,
            "_sourceRow": str(int(_)+2),
            "decisionNo": text(value(row, "处罚决定书文号")),
            "customs": customs,
            "parentCustoms": parent_customs,
            "penaltyDate": date_text(value(row, "处罚日期")),
            "recognizedFiles": text(value(row, "正文识别文件")),
            "violationDate": date_text(value(row, "违法日期")),
            "party": party,
            "type": types[0],
            "types": types,
            "classificationPairs": pairs,
            "reason": reason or "未分类",
            "lawInspectionObject": law_inspection_object,
            "secondaryItem": secondary_item or "未分类",
            "cargo": cargo,
            "brand": text(value(row, "品牌")),
            "specification": text(value(row, "规格型号")),
            "otherElements": text(value(row, "其他要素")),
            "declaredCode": declared_code,
            "actualCode": actual_code,
            "companyProduct": is_company_product,
            "companyProductMatches": product_matches,
            "peerCompany": peer_matches[0] if peer_matches else "",
            "peerMatches": peer_matches,
            "amount": amount,
            "illegalOperationAmount": illegal_operation_amount,
            "taxUnderpaymentAmount": tax_underpayment_amount,
            "fine": fine,
            "recoveryAmount": recovery_amount,
            "penaltyAmount": penalty_amount,
            "fineRate": rate,
            "fineRateBasis": rate_basis,
            "facts": facts,
            "penaltyResult": text(value(row, "处罚结果")),
            "legalBasis": text(value(row, "违法依据")),
            "penaltyBasis": text(value(row, "处罚依据")),
            "complianceTip": text(value(row, "合规提醒")),
            "originalUrl": "",
            "originalLabel": "暂未上传",
            "ocrText": "",
        }
        cases.append(record)

    # 名单与通知读取同一份案例库，收件邮箱不进入静态页面。
    from company_watch import process_watchlist, identity as watch_identity
    for case in cases:
        case["watchCaseKey"] = watch_identity(case)
    observed_cases = [{"id": text(value(row, "案件ID")), "decisionNo": text(value(row, "处罚决定书文号")), "party": text(value(row, "当事人")), "_sourceRow": str(int(index)+2)} for index, row in frame.iterrows() if text(value(row, "案件ID"))]
    watched_companies = process_watchlist(WORKBOOK, cases, observed_cases=observed_cases)
    for case in cases:
        case.pop("_sourceRow", None)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    generated_at = pd.Timestamp.now()
    payload = {
        "updatedAt": generated_at.strftime("%Y-%m-%d %H:%M:%S"),
        "version": generated_at.isoformat(),
        "source": "海关行政处罚案例库.xlsx / 案件信息",
        "companyProductsSource": "公司产品.xlsx / 组件",
        "peerCompaniesSource": "peer_companies.json / 同行企业主体库",
        "companyProductCodeCount": len(product_codes),
        "companyProductNameCount": len(product_names),
        "searchFields": ['id', 'decisionNo', 'customs', 'parentCustoms', 'party', 'type', 'types', 'reason', 'lawInspectionObject', 'secondaryItem', 'cargo', 'brand', 'specification', 'otherElements', 'declaredCode', 'actualCode', 'facts', 'legalBasis', 'penaltyBasis', 'complianceTip', 'ocrText'],
        "cases": cases,
        "watchedCompanies": watched_companies,
        "excludedSeizureNoticeCount": excluded_seizure_notices,
        "unmappedCustoms": sorted(unmapped_customs),
    }
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(serialized, encoding="utf-8")
    # file:// 模式下浏览器会禁止 fetch JSON。同步输出一个普通脚本，供双击
    # index.html 的本地查看场景使用；HTTP/Pages 访问仍优先读取 cases.json。
    INLINE_OUTPUT.write_text(
        f"window.__CUSTOMS_CASES_DATA__ = {serialized};\n",
        encoding="utf-8",
    )
    print(f"已生成 {len(cases)} 条案件数据：{OUTPUT}")
    print(f"收缴清单已从HTML排除：{excluded_seizure_notices} 条（仍保留在案例库）")
    print(f"公司产品清单：{len(product_codes)} 个 HS 编码，{len(product_names)} 个产品名称")
    print(f"已生成本地直开数据：{INLINE_OUTPUT}")
    print(f"打开网址：{(PROJECT_DIR / 'dist' / 'index.html').resolve().as_uri()}")
    if unmapped_customs:
        print(f"以下处罚海关缺少直属海关：{', '.join(sorted(unmapped_customs))}")


if __name__ == "__main__":
    main()
