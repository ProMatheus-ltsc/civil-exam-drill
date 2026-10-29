/** 资料速算 · 计算功底模块（加法/减法/多项求和/多项求差/乘法平方/除法估算/敏感数/小数） */
import { fmt, round } from "../random";
import { options, tailLockedOptions, tailLockInfo, estimateOptions, significantPair } from "../options";
import type { QuestionDraft, Rng } from "../types";

/** 一个数「十位以上的部分」，用于拆分说明：137 → 130 */
const tensOf = (value: number) => Math.floor(value / 10) * 10;

/**
 * 造一对个位凑十的数（两数个位相加为 10）。
 * 文档讲的「先配成整十再相加」得在题里真用得上，否则只是纸上的方法。
 */
function friendlyPair(
  integer: Rng["integer"],
  min: number,
  max: number,
): [number, number] {
  const a = integer(min, max);
  const unit = (10 - (a % 10)) % 10;
  const base = Math.floor(integer(min, max) / 10) * 10 + unit;
  return [a, Math.min(max, Math.max(min, base))];
}

/**
 * 通用整数选项，一半题按真题习惯让四个选项末位互异（尾数法可用），
 * 另一半把干扰项做成 ±10（漏进位/多退位的典型错法，末位相同 → 尾数法失效，必须算准进借位）。
 * 同时返回解析里该给哪条判断建议——方法讲在文中，也得在选项上体现出来。
 * 调用方保证答案 ≥ 15，不会出现负数选项。
 */
function numericOptions(answer: number, random: () => number) {
  const tailDecisive = random() > 0.5;
  const set = tailDecisive
    ? options(answer, [answer + 1, answer - 1, answer + 2], "", random, 0)
    : options(answer, [answer - 10, answer + 10, answer + 1], "", random, 0);
  return {
    set,
    tip: tailDecisive
      ? `四个选项末位互异，只算个位 ${answer % 10} 就能定位（尾数法）。`
      : `干扰项做成 ±10（多退位/漏进位的典型错法），末位与答案相同或相邻，尾数法难以定位，必须把进借位算准。`,
  };
}

/** 生成两个加数：decimals 0=整数（至多 1/10 凑整对） 1=一位小数 2=两位小数；均不超过三位有效数字 */
function additionOperands(
  integer: Rng["integer"],
  random: () => number,
  level: number,
  decimals: number,
): [number, number] {
  if (decimals === 1) {
    const [lo, hi] = level === 1 ? [12, 98] : [123, 987];
    return [integer(lo, hi) / 10, integer(lo, hi) / 10];
  }
  if (decimals === 2) return [integer(123, 987) / 100, integer(123, 987) / 100];
  const min = level === 1 ? 12 : level === 2 ? 106 : 118;
  const max = level === 1 ? 98 : level === 2 ? 896 : 986;
  return random() > 0.9
    ? friendlyPair(integer, min, max)
    : [integer(min, max), integer(min, max)];
}

/**
 * 加法：只出两项纯加法，不掺减法，每个加数不超过三位有效数字、可带一位/两位小数（小数点在中间）。
 * easy 两位数或一位小数；medium/hard 三位数或带小数（两位小数从 medium 起）。
 */
export function generateAddition(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const decimals =
    random() < (level === 1 ? 0.25 : level === 2 ? 0.4 : 0.5)
      ? level >= 2 && random() < 0.5
        ? 2
        : 1
      : 0;
  const [first, second] = additionOperands(integer, random, level, decimals);
  const answer = round(first + second, decimals);
  if (decimals > 0) {
    const step = decimals === 1 ? 0.1 : 0.01;
    const set = options(
      answer,
      [round(answer + step, decimals), round(answer - step, decimals), round(answer + 1, decimals)],
      "",
      random,
      decimals,
    );
    return {
      templateId: decimals === 1 ? "addition-decimal1-v2" : "addition-decimal2-v2",
      params: { expression: `${fmt(first, decimals)}+${fmt(second, decimals)}`, answer },
      stem: `不使用计算器，计算 ${fmt(first, decimals)}+${fmt(second, decimals)}。`,
      ...set,
      explanation: `对齐小数点逐位相加：${fmt(first, decimals)}+${fmt(second, decimals)}=${fmt(answer, decimals)}。干扰项与答案只差 ${step === 0.1 ? "0.1" : "0.01"} 或 1，须保留 ${decimals} 位小数核对。`,
    };
  }
  const tensPart = tensOf(first) + tensOf(second);
  const onesPart = (first % 10) + (second % 10);
  const carry = Math.floor(onesPart / 10);
  const paired = first % 10 !== 0 && (first + second) % 10 === 0;
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: "addition-pair-v2",
    params: { expression: `${first}+${second}`, answer },
    stem: `不使用计算器，计算 ${first}+${second}。`,
    ...set,
    explanation:
      `拆分相加：${tensOf(first)}+${first % 10}、${tensOf(second)}+${second % 10}；整十部分合计 ${tensPart}、零头合计 ${onesPart}${carry > 0 ? `（向十位进 ${carry}）` : ""}，得 ${answer}。` +
      (paired
        ? `${first} 与 ${second} 的个位刚好凑成 10，先配成整十（${first + second}）再合并更快。`
        : "") +
      tip,
  };
}

/**
 * 减法：只出减法，不掺加法。三种考法——
 * borrow 退位减法（个位不够减）；round-sub 减数凑整（看成整十/整百再补回）；
 * round-minuend 整十/整百/整千被减数（连续借位，如 5000−1346）。
 */
export function generateSubtraction(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant =
    level === 1
      ? pick(["borrow", "round-sub"] as const)
      : pick(["borrow", "round-sub", "round-minuend"] as const);
  let minuend = 0;
  let subtrahend = 0;
  let roundBase = 0;
  if (variant === "borrow") {
    // 先均匀定答案与借位结构（减数个位 v 比被减数个位 u 大），再反推被减数/减数；
    // 修复旧实现里减数高位总取最小值、答案扎堆（大量 22~29 如 24）的问题
    const [tLo, tHi, sUnit, mHi] =
      level === 1
        ? [1, 7, 10, 90]
        : level === 2
          ? [12, 87, 100, 980]
          : [30, 87, 100, 980];
    let u = 0;
    let v = 0;
    let ones = 0;
    let t = 0;
    do {
      u = integer(0, 8);
      v = integer(u + 1, 9);
      ones = 10 + u - v;
      t = integer(tLo, tHi);
    } while (10 * t + ones < 16);
    const sPrime = 10 * integer(sUnit / 10, (mHi - 10 * (t + 1)) / 10);
    minuend = sPrime + 10 * (t + 1) + u;
    subtrahend = sPrime + v;
  } else if (variant === "round-sub") {
    const [unitBase, offLo, offHi, baseHi] =
      level === 1 ? [10, 1, 9, 8] : level === 2 ? [100, 11, 39, 9] : [100, 11, 59, 9];
    roundBase = integer(level === 1 ? 3 : 2, baseHi) * unitBase;
    subtrahend = roundBase - integer(offLo, offHi);
    minuend = integer(
      subtrahend + 16,
      level === 1 ? 99 : Math.min(999, roundBase + 89),
    );
  } else {
    const unitBase = level === 1 ? 10 : 100;
    minuend = integer(level === 1 ? 4 : 2, 9) * unitBase;
    roundBase = minuend;
    subtrahend = integer(unitBase + 5, minuend - 16);
  }
  const answer = minuend - subtrahend;
  const ones = minuend % 10;
  const borrowOnes = subtrahend % 10;
  // 三位数退位题用“21/12”分段讲：后两位够减先算后两位再算百位，不够减则百位先借 1
  const splitMethod =
    level === 2 && variant === "borrow"
      ? (() => {
          const mh = Math.floor(minuend / 100);
          const mm = minuend % 100;
          const sh = Math.floor(subtrahend / 100);
          const ss = subtrahend % 100;
          return mm >= ss
            ? `三位数分段“21”：后两位 ${mm}−${ss}=${mm - ss}，百位 ${mh}−${sh}=${mh - sh}，合起来 ${answer}。`
            : `三位数分段“12”：百位借 1，${mh}−1−${sh}=${mh - 1 - sh}；后两位 ${mm + 100}−${ss}=${mm + 100 - ss}，合起来 ${answer}。`;
        })()
      : "";
  const method =
    variant === "borrow"
      ? splitMethod ||
        `按位退位：个位 ${ones} 不够减 ${borrowOnes}，从十位借 1 后 ${ones + 10}−${borrowOnes}=${ones + 10 - borrowOnes}，再算高位得 ${answer}。`
      : variant === "round-sub"
        ? `把减数凑整：${minuend}−${subtrahend}=(${minuend}−${roundBase})+${roundBase - subtrahend}=${minuend - roundBase}+${roundBase - subtrahend}。`
        : `被减数是整${level === 1 ? "十" : level === 2 ? "百" : "千"}数：先向它借 1——(${minuend - 1})−${subtrahend}+1=${minuend - 1 - subtrahend}+1，避免个位连续借位。`;
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: `subtraction-${variant}-v2`,
    params: { expression: `${minuend}-${subtrahend}`, answer },
    stem: `不使用计算器，计算 ${minuend}−${subtrahend}。`,
    ...set,
    explanation: `${method}结果为 ${answer}。验算习惯：差＋减数＝被减数，即 ${answer}+${subtrahend}=${minuend}。${tip}`,
  };
}

/**
 * 连加的三种解法。按「题面本身有什么结构」选，不按项数硬套：
 * - base  各项都挤在同一整十附近 → 基准数法（基准×项数 ＋ 差值合计）
 * - pair  个位能两两凑成整十     → 配对凑整（项数减半）
 * - digit 没有上述结构           → 分位累加（个位/十位/百位各收一列，只做一次进位）
 * 项数越多越不该「一项一项累加」：中间和要一直记着，进位还要反复做。
 */
type SumMode = "base" | "pair" | "digit";

/** 造一对个位相加为 10 的数（27 与 63）。个位是 0 的数不参与配对，否则「凑十」是假的 */
function unitPair(integer: Rng["integer"], min: number, max: number): [number, number] {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const first = integer(min, max);
    if (first % 10 === 0) continue;
    const second = integer(Math.ceil(min / 10), Math.floor(max / 10)) * 10 + (10 - (first % 10));
    if (second >= min && second <= max) return [first, second];
  }
  return friendlyPair(integer, min, max);
}

/** 造一组都挤在同一整十附近的数：基准数法要用得上，跨度就得真的小 */
function clusteredValues(
  integer: Rng["integer"],
  count: number,
  min: number,
  max: number,
  spread: number,
): { values: number[]; base: number } {
  const center = Math.round(integer(min + spread, max - spread) / 10) * 10;
  const values = Array.from({ length: count }, () =>
    Math.min(max, Math.max(min, center + integer(-spread, spread))),
  );
  const average = values.reduce((sum, value) => sum + value, 0) / count;
  const base = Math.max(10, Math.round(average / 10) * 10);
  return { values, base };
}

/**
 * 分位累加的分步说明：个位收一列、十位收一列……逐位写数并进位，最后拼出结果。
 * 这是项数多时的通用解法，也是唯一不会在中间某一步丢数的算法。
 */
function columnSteps(values: number[]) {
  const columns = [
    { name: "个位", place: 0 },
    { name: "十位", place: 1 },
    { name: "百位", place: 2 },
    { name: "千位", place: 3 },
  ];
  let carry = 0;
  const steps: string[] = [];
  const digits: string[] = [];
  for (const [index, column] of columns.entries()) {
    const columnDigits = values.map((value) => Math.floor(value / 10 ** column.place) % 10);
    const columnSum = columnDigits.reduce((sum, digit) => sum + digit, 0);
    const total = columnSum + carry;
    if (index > 0 && total === 0) break;
    const kept = total % 10;
    const next = Math.floor(total / 10);
    steps.push(
      `${column.name} ${columnDigits.join("+")}=${columnSum}${carry > 0 ? `，加低位进位 ${carry} 得 ${total}` : ""} → 留 ${kept}${next > 0 ? `、进 ${next}` : ""}`,
    );
    digits.unshift(String(kept));
    carry = next;
  }
  if (carry > 0) digits.unshift(String(carry));
  return { text: steps.join("；"), result: digits.join("") };
}

/** 连加题的共用主体：造数（按结构分三种）＋ 对应解法的解析 ＋ 选项 */
function sumDraft(
  topicId: "sum-many" | "sum-long",
  r: Rng,
  count: number,
  min: number,
  max: number,
): QuestionDraft {
  const { integer, random } = r;
  const spread = max >= 100 ? 25 : 12;
  const roll = random();
  let values: number[];
  let mode: SumMode;
  let base = 0;
  if (roll < 0.34) {
    mode = "base";
    const clustered = clusteredValues(integer, count, min, max, spread);
    values = clustered.values;
    base = clustered.base;
  } else if (roll < 0.68) {
    mode = "pair";
    values = [];
    while (values.length + 2 <= count) values.push(...unitPair(integer, min, max));
    while (values.length < count) values.push(integer(min, max));
  } else {
    mode = "digit";
    values = Array.from({ length: count }, () => integer(min, max));
  }
  const answer = values.reduce((sum, value) => sum + value, 0);
  let method: string;
  if (mode === "base") {
    const diffs = values.map((value) => value - base);
    const diffSum = diffs.reduce((sum, diff) => sum + diff, 0);
    const spreadOfValues = Math.max(...values) - Math.min(...values);
    method =
      `基准数法：${count} 项都落在 ${base} 附近（实际跨度 ${spreadOfValues}），先把整十部分拎出来算——` +
      `各项写成 ${values
        .map((value, index) =>
          diffs[index] === 0
            ? `${value}（正好是基准）`
            : `${value}=${base}${diffs[index] > 0 ? "+" : "−"}${Math.abs(diffs[index])}`,
        )
        .join("、")}；基准部分 ${base}×${count}=${base * count}，差值合计 ${
        diffSum >= 0 ? `+${diffSum}` : `−${Math.abs(diffSum)}`
      }，合计 ${answer}。`;
  } else if (mode === "pair") {
    const pairs: string[] = [];
    const rest: number[] = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      if ((values[index] + values[index + 1]) % 10 === 0)
        pairs.push(`${values[index]}+${values[index + 1]}=${values[index] + values[index + 1]}`);
      else rest.push(values[index], values[index + 1]);
    }
    if (values.length % 2 === 1) rest.push(values[values.length - 1]);
    const restSum = rest.reduce((sum, value) => sum + value, 0);
    method =
      `配对凑整：先扫个位，把能凑成整十的两项配成对——${pairs.join("、")}` +
      (rest.length === 1
        ? `；再加余下的 ${rest[0]}`
        : rest.length > 1
          ? `；再加余下的 ${rest.join("+")}=${restSum}`
          : "") +
      `，合计 ${answer}。` +
      (pairs.length > 1
        ? `${count} 项配完只剩 ${pairs.length} 个整十加数，加法次数少一半。`
        : `${count} 项里能配成对就先配，配不上的零头单独加。`);
  } else {
    const columns = columnSteps(values);
    method =
      (count >= 4
        ? "分位累加：项数多时别一项一项加（中间和记不住、进位还得反复做），改成按位收——"
        : "分位累加（高位叠加）：把同一位上的数分别相加、逐位进位——") +
      `${columns.text}；` +
      `拼起来是 ${columns.result}。个位那一列之和的个位（${answer % 10}）是天然的校验位，对不上就是进位错了。`;
  }
  const { set, tip } = numericOptions(answer, random);
  const methodTip =
    mode === "base"
      ? count >= 4
        ? "项数越多这一招越省：多次多位加法换成了一次乘法加几个小差值。"
        : "几项都挤在同一个整十附近时，这样算比逐项相加少做一次进位。"
      : mode === "pair"
        ? "配对只看个位（3 与 7、4 与 6、9 与 1、2 与 8、5 与 5），配不上的零头最后单独加。"
        : "按位收的好处是不必记住越来越大的中间和，进位只在最后合并时做一次。";
  return {
    templateId: `${topicId}-${mode}-v3`,
    params: { expression: values.join("+"), answer },
    stem: `不使用计算器，计算 ${values.join("+")}。`,
    ...set,
    explanation: `${method}${methodTip}${tip}`,
  };
}

/**
 * 多项求和：固定 3 项。梯度只拉「位数」这一维（2 位 → 3 位），
 * 不再把项数一起加进来——4 项以上的连加另立一关《多项连加》。
 */
export function generateSumMany(r: Rng): QuestionDraft {
  const { level } = r;
  return sumDraft("sum-many", r, 3, level === 1 ? 12 : 106, level === 3 ? 976 : level === 1 ? 98 : 896);
}

/**
 * 多项连加：4 项起步，梯度只拉「项数」这一维——
 * easy 4 项两位数（先把「多一项」练顺）→ medium 4 项三位数 → hard 5~6 项三位数（实战材料）。
 * 项数一多，逐项累加必错，所以造数刻意给出三种真实结构：各项挤在同一整十附近（基准数法）、
 * 个位能成对凑十（配对凑整）、以及没有结构的普通散布（分位累加）。
 */
export function generateSumLong(r: Rng): QuestionDraft {
  const { level, random } = r;
  const count = level <= 2 ? 4 : random() < 0.3 ? 6 : 5;
  const min = level === 1 ? 12 : level === 2 ? 106 : 118;
  const max = level === 1 ? 98 : level === 2 ? 896 : 976;
  return sumDraft("sum-long", r, count, min, max);
}

/**
 * 多项求差：公考里以「精确计算」出现（连减求剩余、两组和相减求增量），选项精度一致时可用尾数法。
 * chain：总量 − 各部分 = 剩余（「其余支出」类）；pairs：两组分别求和再相减（同比增加量类）。
 */
export function generateDiffMany(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const variant = pick(["chain", "pairs"] as const);
  const lo = level === 1 ? 12 : level === 2 ? 106 : 118;
  const hi = level === 1 ? 58 : level === 2 ? 486 : 886;
  if (variant === "chain") {
    const partCount = level === 1 ? 2 : 3;
    const parts = Array.from({ length: partCount }, () => integer(lo, hi));
    const partSum = parts.reduce((sum, value) => sum + value, 0);
    const remainder = integer(level === 1 ? 20 : 118, level === 1 ? 98 : hi);
    const total = partSum + remainder;
    const { set, tip } = numericOptions(remainder, random);
    return {
      templateId: "diff-chain-v2",
      params: { expression: [total, ...parts].join("-"), answer: remainder },
      stem: `不使用计算器，计算 ${[total, ...parts].join("−")}。`,
      ...set,
      explanation: `两种算法都行：① 依次连减 ${total}${parts.map((value) => `−${value}`).join("")}=${remainder}；② 先把各部分加起来（${parts.join("+")}=${partSum}），再用总量减：${total}−${partSum}=${remainder}。后者少做几次借位，更稳。${tip}`,
    };
  }
  // pairs：两组数各自求和，保证第一组更大、差值 ≥ 16
  const group = () => [integer(lo, hi), integer(lo, hi)] as [number, number];
  let first = group();
  let second = group();
  if (first[0] + first[1] < second[0] + second[1]) [first, second] = [second, first];
  const gap = first[0] + first[1] - (second[0] + second[1]);
  if (gap < 16) first = [first[0] + (16 - gap), first[1]];
  const firstSum = first[0] + first[1];
  const secondSum = second[0] + second[1];
  const answer = firstSum - secondSum;
  const { set, tip } = numericOptions(answer, random);
  return {
    templateId: "diff-pairs-v2",
    params: { expression: `${first[0]}+${first[1]}-${second[0]}-${second[1]}`, answer },
    stem: `不使用计算器，计算 ${first[0]}+${first[1]}−${second[0]}−${second[1]}。`,
    ...set,
    explanation: `两组各自求和再相减：(${first[0]}+${first[1]})−(${second[0]}+${second[1]})=${firstSum}−${secondSum}=${answer}。逐项对比更快：${first[0]}−${second[0]}=${first[0] - second[0]}、${first[1]}−${second[1]}=${first[1] - second[1]}，两个差值相加仍得 ${answer}（单项差值可能为负，只作中间量）。${tip}`,
  };
}

/**
 * 把两位数拆成两个一位数：12~49 中只有 12、14、15、16、18、21、24、27、28、32、35、36、42、45、48 等能拆。
 * 返回 null 表示拆不开（如质数 23、29、31、37、41、43、47），此时应改用凑整十的分配律。
 */
function factorPair(b: number): [number, number] | null {
  for (let first = 2; first <= 9; first += 1) {
    if (b % first === 0) {
      const second = b / first;
      if (second >= 2 && second <= 9) return [first, second];
    }
  }
  return null;
}

/**
 * 乘法与平方：对齐资料分析真题的三种形态，按固定比例混合出题（三档通用）。
 *
 * 1）**估算题（主体，约 65%）**：两数各取前两位有效数字（"看三位、取两位"）算出估算值，
 *    选项按 6% 刻度铺开。这正是资料分析里 A×B 的真实解法——选项差距 ≥5% 时只需求到
 *    首位有效数字，练的是"敢不敢估、估得准不准"，而不是"算得快不快"。
 * 2）**平方题（约 20%）**：凑整十展开，对应 (1+r)² 复合增长与几何面积场景。
 * 3）**精算题（少数派，约 15%）**：模拟"选项差距 <5%、必须算全"的情形，选项尾位锁定。
 *    资料分析里这类题占比很低，所以每档只掺 1~2 道，不作为整档主线。
 *
 * 平方只保留"贴近实战"的形态，方法收敛到「凑整十 ± 补数」一条主线。
 */
export function generateMultiply(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  // 四种形态按固定比例抽取，三档通用：
  //   估算（有效数字乘法，主体，~37%）
  //   百分数（多位数 × x.x%，~30%）——资料分析最高频的动作
  //   精算（选项差距小、锁尾位，少数派场景，~15%）
  //   平方（凑整十展开，对应 (1+r)²/几何面积，~18%）
  const roll = random();
  const wantSquare = roll > 0.82;
  const wantExact = roll > 0.67 && roll <= 0.82;
  const wantPercent = roll >= 0.37 && roll < 0.67;
  if (wantSquare) {
    const a = level === 1 ? integer(12, 39) : level === 2 ? integer(41, 89) : integer(61, 99);
    const answer = a * a;
    const near = Math.round(a / 10) * 10;
    const d = a - near;
    const method =
      d === 0
        ? `${a}² 即 ${a}×${a}，直接相乘得 ${fmt(answer)}。`
        : `${a}² 用凑整十展开：(${near}${d > 0 ? "+" : ""}${d})²=${fmt(near)}²${d > 0 ? "+" : "−"}2×${Math.abs(near)}×${Math.abs(d)}+${Math.abs(d)}²=${fmt(near * near)}${d > 0 ? "+" : "−"}${fmt(2 * Math.abs(near) * Math.abs(d))}+${Math.abs(d) * Math.abs(d)}=${fmt(answer)}。`;
    // 平方是**精算题**，选项必须精确到个位：曾经误用 estimateOptions（估算选项），
    // 它会把答案对齐到 10^(位数-1) 的整数倍——35²=1225 被抹成 1200，
    // 用户算出 1225 反而找不到选项。改为按「经典错法」构造干扰项。
    // 三项错法的末位都与 a² 相同（因为差值都是 2·near·d 的倍数，near 是 10 的倍数），
    // 既保留尾数法防秒杀，又对应真实手算错误：
    //   漏掉交叉项 / 交叉项符号反 / 交叉项算成两倍
    const cross = 2 * near * d;
    const wrongMissingCross = near * near + d * d;
    const wrongSignFlip = near * near - cross + d * d;
    const wrongDoubleCross = near * near + 2 * cross + d * d;
    const set =
      d === 0
        ? tailLockedOptions(answer, random)
        : options(answer, [wrongMissingCross, wrongSignFlip, wrongDoubleCross], "", random, 0);
    return {
      templateId: "multiply-square-v3",
      params: { a, b: a, answer },
      stem: `不使用计算器，计算 ${a}²。`,
      ...set,
      explanation: `【最优解】${method}${d === 0 ? "" : ` 关键是把 ${a} 折到整十 ${near}，用「整十平方 ± 补数项」一步出结果。`}${d === 0 ? "" : ` 干扰项里 ${fmt(wrongMissingCross)} 是漏掉交叉项、${fmt(wrongSignFlip)} 是符号搞反、${fmt(wrongDoubleCross)} 是把交叉项算成两倍——这三个正是手算平方最常见的错。`}`,
    };
  }

  // 精算形态（三档各约 15%）：模拟"选项差距 <5%、必须算全"的少数派场景
  if (wantExact) {
    const a = integer(103, 999);
    const b = level === 1 ? integer(12, 29) : integer(11, 49);
    const answer = a * b;
    const set = tailLockedOptions(answer, random);
    const lock = tailLockInfo(set);
    const tailTip = lock.lastTwoSame
      ? `选项末两位均为 ${String(answer).slice(-2)}，估算与尾数法都失效，必须精确计算。`
      : `选项末位相同，单看尾数无法定位；干扰项量级接近，需结合完整乘积判断。`;
    // 优先判断 b 能否拆成两个一位数（降维最省），否则退回凑整十的分配律
    const factors = factorPair(b);
    const method = factors
      ? `先把 ${b} 降维成 ${factors[0]}×${factors[1]}：${a}×${factors[0]}=${fmt(a * factors[0])}，再 ×${factors[1]} 得 ${fmt(answer)}`
      : `把 ${b} 拆成 ${fmt(tensOf(b))}+${b % 10}：${a}×${fmt(tensOf(b))}=${fmt(a * tensOf(b))}，${a}×${b % 10}=${fmt(a * (b % 10))}，两部分相加得 ${fmt(answer)}`;
    return {
      templateId: "multiply-exact-v3",
      params: { a, b, answer },
      stem: `不使用计算器，计算 ${a}×${b}（结果精确到个位）。`,
      ...set,
      explanation: `【精确计算】${method}。 本题选项锁定尾位、差距很小，估算救不了，只能算全（资料分析里这类题只占少数）：先看 ${b} 能不能拆成两个一位数——${factors ? "能拆，降维最省两次一位数乘法" : `${b} 拆不开（或拆分不划算），改用凑整十的分配律`}。${tailTip}`,
    };
  }

  // 百分数形态（~30%）：多位数 × x.x%
  // 资料分析里乘法几乎都是这个形态——「现期 × 增长率」「整体 × 比重」。
  // 它比纯数字乘法多一层「% 转小数」，也是最容易把小数点搞错的地方。
  if (wantPercent) {
    const base =
      level === 1
        ? integer(40, 98) * 10
        : level === 2
          ? integer(120, 980) * 10
          : integer(1200, 9800) * 10;
    const rate =
      level === 1
        ? integer(10, 40)
        : Math.round(integer(15, level === 2 ? 255 : 355)) / 10;
    const answer = Math.round((base * rate) / 100);
    const set = estimateOptions(answer, 0.06, random, 0);
    // 演示「取两位有效数字」：12 × 57 = 684，再按量级定小数点
    const sigBase = Number(String(base).slice(0, 2));
    const sigRate = Number(String(rate).replace(".", "").slice(0, 2));
    // 小数必须收敛到 4 位：直接写 rate/100 会在解析里暴露 8.2% = 0.08199999999999999
    const rateDecimal = Number((rate / 100).toFixed(4));
    const zeros = String(base).length - 2;
    const roughBase = Math.round(base / 10 ** zeros) * 10 ** zeros;
    const baseText = roughBase === base ? `${base}` : `${base}≈${roughBase}`;
    return {
      templateId: "multiply-percent-v1",
      params: { base, rate, answer },
      stem: `不使用计算器估算 ${base}×${rate}%，下列各选项中最接近实际结果的是？`,
      ...set,
      explanation: `【最优解】先把 ${rate}% 转成小数（${rate}% = ${rateDecimal}），再取两位有效数字：${sigBase}×${sigRate}=${sigBase * sigRate}。定小数点：${baseText}，${roughBase}×${rateDecimal}≈${answer}。**最常见的错**是忘了「% 等于除以 100」，把结果直接放大 100 倍——看到百分号，先在心里把小数点往前挪两位。`,
    };
  }

  // 估算形态（默认，三档主体）：有效数字乘法。
  // 两数都给三位以上，保证「第三位观察位」真实存在——否则取两位后数字没变化，估算无从练起。
  const a = level === 1 ? integer(112, 986) : level === 2 ? integer(1024, 9876) : integer(10024, 98765);
  const b = level === 2 ? integer(1032, 9864) : level === 3 ? integer(1123, 9865) : integer(113, 985);
  const answer = a * b;
  const { approxA, approxB, estimate, rule } = significantPair(a, b);
  const set = estimateOptions(answer, 0.06, random, 0);
  const ruleText =
    rule === "舍"
      ? "两数第三位都在 0~2，全部舍去"
      : rule === "进"
        ? "两数第三位都在 8~9，全部进位"
        : "前两位有效数字较小的一方四舍五入、较大的一方反向取舍";
  const diffRate = fmt(Math.abs((estimate - answer) / answer) * 100, 1);
  const correct = set.options[set.answerIndex];
  return {
    templateId: "multiply-estimate-v3",
    params: { a, b, answer },
    stem: `不使用计算器估算 ${a}×${b}，下列各选项中最接近实际结果的是？`,
    ...set,
    explanation: `【估算】看三位、取两位：${ruleText}，${a} 取 ${fmt(approxA)}、${b} 取 ${fmt(approxB)}，得 ${fmt(approxA)}×${fmt(approxB)}=${fmt(estimate)}，与实际值（${fmt(answer)}）相差约 ${diffRate}%，最接近的选项为 ${correct}。 资料分析里乘法几乎都是这样估的——选项差距 ≥5% 时，"首位对得上"就够定位，硬算完整乘积反而浪费时间。`,
  };
}

export function generateDivide(r: Rng): QuestionDraft {
  const { level, integer, random } = r;
  const divisor = integer(level === 1 ? 4 : 12, level === 1 ? 9 : level === 2 ? 49 : 199);
  const quotient = integer(12, 99 * level);
  const estimate = random() > 0.5;
  const remainder = estimate ? integer(1, Math.max(1, Math.floor(divisor / 3))) : 0;
  const dividend = divisor * quotient + remainder;
  // 选项间距按资料分析真题口径铺开、随难度收窄：简单 12%（估首位即可定位）、
  // 中等 6%（要估到第二位）、困难 3.5%（接近精算）。
  // 不能用 ±1 做干扰项——那等于逼考生列竖式逐个试乘，把「估算」考成「精算」，
  // 题干写「估算」选项却要求个位不差，属于自相矛盾的题目（真实考试选项间距 ≥5%）。
  const spread = level === 1 ? 0.12 : level === 2 ? 0.06 : 0.035;
  const shift = (from: number, rate: number, direction: 1 | -1) => {
    // 向外取整：向上项取 ceil、向下项取 floor，保证实际间距不小于名义值
    // （直接 round 会让 85×1.24=105.4 缩成 105，相邻只剩 10.5%）
    const raw = from * (1 + direction * rate);
    const rounded = direction === 1 ? Math.ceil(raw) : Math.floor(raw);
    // 商较小时相对间距会退化成 0 或 1，强制留出至少 2 的可辨差距
    return Math.abs(rounded - from) >= 2 ? rounded : from + direction * 2;
  };
  const up = shift(quotient, spread, 1);
  const down = shift(quotient, spread, -1);
  // 第三个干扰项在 up 之上再退一格，避免「2×spread 相对答案」在小商时被取整压窄
  const far = shift(up, spread, 1);
  const set = options(quotient, [up, down, far], "", random, 0);
  return {
    templateId: estimate ? `division-estimate-${level}-v3` : `division-exact-${level}-v3`,
    params: { dividend, divisor, quotient, remainder },
    stem: `不使用计算器，${estimate ? "估算" : "计算"} ${dividend}÷${divisor}${estimate ? "（取最接近的整数）" : ""}。`,
    ...set,
    explanation: estimate
      ? `先看 ${divisor} 的整数倍：${divisor}×${quotient}=${divisor * quotient}，余 ${remainder} 不足半个除数（${divisor}÷2≈${fmt(divisor / 2)}），所以取 ${quotient}。资料分析里选项间距远大于余数造成的误差，估到「整商」就够定位，不必逐个试乘。`
      : `直除首商：${divisor}×${quotient}=${dividend} 恰好整除，所以商为 ${quotient}。先定首位（${divisor}×${quotient >= 10 ? Math.floor(quotient / 10) * 10 : quotient} 已接近 ${dividend}），再补末位即可。`,
  };
}

export function generateSensitive(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const hard = level === 3;
  const denominator = pick(level === 1 ? [4, 5, 8, 10] : level === 2 ? [6, 8, 12, 16] : [7, 11, 13, 16]);
  // 高难度不再总是 1/n：2/7、3/11 这类分数同样要会百化分，
  // 且部分量要先拆成“每份”再乘总份数，不能一步看出答案。
  const numerator = hard
    ? denominator === 16
      ? 3
      : integer(2, Math.min(3, denominator - 1))
    : integer(1, Math.min(3, denominator - 1));
  const unit = hard
    ? integer(4 * level, 24 * level) * 7
    : integer(4 * level, 24 * level) * 10;
  const part = unit * numerator;
  const whole = unit * denominator;
  const percent = round((100 * numerator) / denominator, 1);
  const variant = integer(0, 2);
  if (variant === 0) {
    const set = options(
      whole,
      hard
        ? [whole + unit, whole - unit, whole + unit * 2]
        : [part * (denominator - numerator), part * denominator, whole + unit],
      " 亿元",
      random,
      hard ? 0 : 2,
    );
    return {
      templateId: "sensitive-fraction-to-whole-v2",
      params: { denominator, numerator, part, whole },
      stem: `某地区高新技术企业实现营业收入 ${part} 亿元，占全部规上企业营业收入的 ${percent}%。全部规上企业营业收入约为多少亿元？`,
      ...set,
      explanation: `识别“部分÷占比=整体”。${percent}%≈${numerator}/${denominator}（百化分）；按份数算：${part}÷${numerator}×${denominator}=${whole} 亿元。`,
    };
  }
  if (variant === 1) {
    const answer = round((part / whole) * 100, 1);
    const set = options(
      answer,
      [
        round(100 / denominator, 1),
        round((100 * (denominator - numerator)) / denominator, 1),
        round(answer + (hard ? 1 : 5), 1),
      ],
      "%",
      random,
      1,
    );
    return {
      templateId: "sensitive-share-v2",
      params: { denominator, numerator, part, whole },
      stem: `某行业完成投资 ${part} 亿元，全行业投资为 ${whole} 亿元。该行业投资占比约为多少？`,
      ...set,
      explanation: `占比=部分÷整体=${part}÷${whole}=${numerator}/${denominator}≈${answer}%。先约成敏感分数再转百分数，避免长除法。`,
    };
  }
  if (hard) {
    const perShare = integer(17, 83);
    const current = (denominator + numerator) * perShare;
    const base = denominator * perShare;
    const growth = numerator * perShare;
    // 高难度干扰项围绕答案铺开：用本期×增速（经典错法）、多一份/少一份，
    // 不再放「基期量」这种一眼就能排除的远项。
    const set = options(
      growth,
      [
        Math.round((current * percent) / 100),
        growth + perShare,
        growth - perShare,
      ],
      " 万吨",
      random,
      0,
    );
    return {
      templateId: "sensitive-growth-shares-v2",
      params: { current, rate: percent, unit: base, growth },
      stem: `某产品本期产量为 ${current} 万吨，同比增长 ${percent}%。增长量约为多少万吨？`,
      ...set,
      explanation: `同比增长 ${percent}%≈${numerator}/${denominator}：把基期看作 ${denominator} 份、本期看作 ${denominator + numerator} 份，增长量=${current}÷${denominator + numerator}×${numerator}=${growth} 万吨。`,
    };
  }
  const rate = pick([10, 20, 25]);
  const current = Math.round((unit * (100 + rate)) / 100);
  const growth = current - unit;
  const set = options(growth, [Math.round((current * rate) / 100), unit, current - growth], " 万吨", random);
  return {
    templateId: "sensitive-growth-shares-v2",
    params: { current, rate, unit, growth },
    stem: `某产品本期产量为 ${current} 万吨，同比增长 ${rate}%。按份数法估算增长量是多少万吨？`,
    ...set,
    explanation: `同比增长 ${rate}% 时基期视为 100 份、本期为 ${100 + rate} 份：基期=${current}÷${100 + rate}×100=${unit}，增长量=${current}−${unit}=${growth} 万吨。`,
  };
}

export function generateDecimal(r: Rng): QuestionDraft {
  const { level, integer, pick, random } = r;
  const digits = level === 1 ? 1 : 2;
  const factor = 10 ** digits;
  const a = integer(80 * level, 300 * level) / factor;
  const b = integer(20 * level, 90 * level) / factor;
  const variant = integer(0, 2);
  if (variant < 2) {
    const operation = variant === 0 ? "+" : "-";
    const left = operation === "-" ? Math.max(a, b) : a;
    const right = operation === "-" ? Math.min(a, b) : b;
    const answer = round(operation === "+" ? left + right : left - right, digits);
    const set = options(answer, [round(answer + 1 / factor, digits), round(answer - 1 / factor, digits), round(left + right, digits)], "", random, digits);
    return {
      templateId: `decimal-${operation === "+" ? "add" : "subtract"}-v2`,
      params: { left, right, operation, digits },
      stem: `某表两项数值分别为 ${fmt(left, digits)} 和 ${fmt(right, digits)}，求二者${operation === "+" ? "合计" : "差值"}。`,
      ...set,
      explanation: `对齐小数点逐位${operation === "+" ? "相加" : "相减"}：${fmt(left, digits)}${operation}${fmt(right, digits)}=${fmt(answer, digits)}。选项只差 ${1 / factor} 时务必保留 ${digits} 位小数核对。`,
    };
  }
  const multiplier = pick([1.1, 1.2, 1.25, 1.5]);
  const answer = round(a * multiplier, digits);
  const set = options(answer, [round(a + multiplier, digits), round(a * (multiplier - 1), digits), round(answer + 1 / factor, digits)], "", random, digits);
  return {
    templateId: "decimal-multiply-split-v2",
    params: { a, multiplier, digits },
    stem: `某指标为 ${fmt(a, digits)}，调整后为原来的 ${multiplier} 倍，调整后的数值是多少？`,
    ...set,
    explanation: `拆 ${multiplier}=1+${fmt(multiplier - 1, 2)}：${fmt(a, digits)}×${multiplier}=${fmt(a, digits)}+${fmt(round(a * (multiplier - 1), digits), digits)}=${fmt(answer, digits)}。`,
  };
}
