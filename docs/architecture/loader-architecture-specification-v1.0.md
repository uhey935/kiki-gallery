# KiKi Gallery Loader Architecture Specification

Version: v1.0 Draft  
Status: Draft for implementation review  
Last Updated: 2026-08-05  
Scope: Content Unit Loader, Astro Adapter, and their boundaries  
Target: Astro 6 Content Layer

---

## 1. Purpose

本仕様は、KiKi Gallery の Repository に保存された Content Unit を、Astro、Editor、Validation、および Migration が安全に利用できる形へ読み込むための正式な Loader Architecture を定義する。

Loader は Repository の事実を失わずに読み取り、解析可能な部分結果と Issue を返す。Loader は公開品質、Editor の操作可否、Migration の移行方針、または Presentation の表示方法を決定しない。

本仕様は目標アーキテクチャを定義する。現行実装は単一 Markdown ファイルと Astro `glob()` Loader を使用しており、本仕様の3ファイル構成および独立 Loader はまだ実装されていない。

---

## 2. Authority and audited baseline

設計判断の優先順位は次のとおりとする。

1. Approved `Content Model Specification v1.0`
2. 本仕様の Decisions 001–012
3. 現行 Astro 6 Schema と Journal consumer の互換要件
4. Migration の過渡的要件

監査時点の現行実装は次のとおりである。

- `src/content.config.ts` が Astro Schema を定義し、`glob()` で単一 `.md` を読む。
- Journal Schema は `date`、1件以上の `categories`、`hero.image`、`title`、`summary`、`hero_alt` を必須とする。
- Journal の `author` と `credits` は任意かつ排他的である。
- `title`、`summary`、`hero_alt` は現在、空文字を許容しない。
- Journal の Markdown body は Schema 上の必須項目ではない。
- Journal の ID はファイル名由来の `entry.id`、route は `/journal/{entry.id}` である。
- Journal 一覧、詳細、Home Stories、News 統合、News 画像解決が `entry.id` とフラットな `entry.data` に依存する。
- Journal 一覧、Home Stories、News 統合はそれぞれ独立して日付降順に sort し、Journal 詳細の `getStaticPaths()` は collection の返却順をそのまま route 生成へ使う。
- Home の News 画像解決は News の内部 link から collection 名と ID を解析し、`entry.id` を key とする Map で Journal Entry を逆引きする。
- 現行 application code は `getEntry()` を使用していない。
- Astro 6 の型推論により `getCollection("journal")` と `CollectionEntry<"journal">` は同じ Journal Schema 由来の `data` shape を共有する。監査時の `astro check` は error 0 で完了した。
- Journal は9件、英語コンテンツは0件である。

この baseline は互換性制約であり、将来構造を現行の単一ファイル実装へ固定するものではない。

---

## 3. Terms

### 3.1 Content ID

Collection 内で Content Unit を一意に識別する値。Publication Unit 移行後は Content Unit のディレクトリ名を使用する。`id`、`slug`、`content_id` を content file 内へ重複保存しない。

### 3.2 Content Unit

1件の content を表す Repository 上の論理単位。恒常運用での正規構造は次のとおりである。

```text
src/content/{collection}/{content-id}/
├── index.yaml
├── ja.md
└── en.md
```

`index.yaml` は Shared data、locale Markdown は Localized frontmatter と raw Markdown body を所有する。

### 3.3 Structural validity

入力が許可された型、field、enum、および同一 object 内の構造制約を満たすこと。Preview または Publish 可能であることを意味しない。

### 3.4 Issue

Parse、Structure、Unit Integrity、Repository Integrity、または Content Quality に関する観測可能な問題。Issue の詳細 model は別仕様で確定する。

---

## 4. Fixed decisions

### Decision 001 — Content identity

- Content ID は Content Unit のディレクトリ名とする。
- Content ID は各 file 内へ保存しない。
- Route は locale、collection、および Content ID から生成する Derived Value とする。
- Astro Entry ID は locale と Content ID から生成する一意な内部値とし、consumer はその文字列形式を解析しない。
- Consumer は Content ID として `entry.data.contentId` を使用する。Astro Entry ID の具体的形式は未決とする。

### Decision 002 — Schema sharing

- Shared、Localized、および Astro Entry の Structural Schema は共通 Schema module を Single Source of Truth とする。
- Astro、Loader、Editor、および Migration は用途別に同じ構造定義を再実装しない。
- TypeScript 型は Schema から推論する。
- Structural Schema は型、field presence、enum、unknown field、object 内の排他制約を扱う。
- Preview と Publish の完成条件は Structural Schema から分離する。
- Localized required string は空文字を構造上許容しない。Migration で未翻訳の EN required field を表す場合は Decision 012 の予約済み Placeholder Token を使用する。

現行の `src/content.config.ts` は Schema 本体と Astro collection 登録が同居している。実装時には Schema module を分離するが、Localized required string の空文字不可という現行保証は維持する。未翻訳状態は Structural Schema を緩めず、Content Quality Validation で判定する。

### Decision 003 — Astro 6 integration

- Content Unit Loader と Astro Content Layer Loader を分離する。
- Repository 上の1 Content Unit から、構造上有効な locale ごとに1 Astro Entry を生成する。
- Astro Adapter は Shared data と対象 locale の Localized data をフラット化する。
- Astro Store へ登録する前に Astro の `parseData()` を通す。
- Parse または Structural Validation に失敗した locale は Store へ登録しない。
- ある locale の失敗または欠損を理由に、別 locale の有効 Entry を捨てない。
- Astro Entry ID は opaque とし、prototype で挙動を検証してから形式を固定する。

### Decision 004 — Consumer isolation

- Presentation Layer は `index.yaml`、`ja.md`、`en.md`、Shared／Localized の保存構造を認識しない。
- Astro Adapter は既存 consumer に近いフラットな `entry.data` を提供する。
- locale の選択と collection query は Query Adapter に集約する。
- route は共通 Route Helper から取得する。
- date sort や「先頭記事を Hero にする」等の表示ロジックは Loader の責務ではない。

Journal の目標 Entry data は少なくとも次を維持する。

```ts
type JournalAstroData = {
  contentId: string;
  locale: "ja" | "en";
  date: string;
  categories: Array<"interview" | "essay" | "report">;
  hero: {
    image: string;
    hero_caption?: string;
  };
  author?: string;
  credits?: JournalCredit[];
  title: string;
  summary: string;
  hero_alt: string;
};
```

### Decision 005 — Markdown boundary

- Loader は Markdown body を raw string として保持する。
- Loader は Markdown を HTML、component、AST、または compiled module へ変換しない。
- Astro Adapter が Astro の Markdown rendering API と接続し、Astro の `render(entry)` 互換を成立させる。
- Editor は raw Markdown を編集し、Loader が生成した compiled output を保存しない。

### Decision 006 — Error recovery

- Recoverable error と Fatal Infrastructure Error を区別する。
- 単一 file または Content Unit の問題で collection 全体を停止しない。
- Parse error 時も raw source と可能な部分結果を保持する。
- 欠損 locale は Loader 全体の例外ではなく、その locale の `missing` state として返す。
- Astro Store には Parse と Structural Validation を通過した locale Entry だけを登録する。
- 外部変更との write conflict は自動上書きしない。
- 意味を推測する自動修復は行わず、明示的に承認された normalization だけを適用する。
- content root、Schema Registry、または File Adapter の初期化不能など、継続不可能な場合のみ Loader 全体を失敗させる。

### Decision 008 — Query Adapter

- Query Adapter は Astro Content Collection に対する純粋な取得境界とする。
- Query Adapter は collection access、必須の locale filter、`entry.data.contentId` による検索、および collection 共通の安定した既定 sort を担当する。
- Journal の既定 sort は date 降順、同日では `contentId` 昇順とし、consumer ごとの表示順の揺れを防ぐ。
- Query Adapter は renderability、previewability、publishability を判定または filter しない。
- locale 単位の renderability は Preview／Site Renderability Validator が判定し、通常サイト向けの取得は Site Content Service が Query Adapter とその判定を合成する。
- Content Unit 全体の Publish 可否は Publish Validator／Capability Evaluator が判定し、locale Entry の renderability と混同しない。
- `entry.id` は Astro Store の lookup key としてのみ扱い、consumer と公開 API はその encoding を知らない。Content ID には `entry.data.contentId` を使用する。
- Query Adapter は route や View Model を返さない。Route Helper と consumer-specific mapper がそれぞれ担当する。
- Query Adapter と Site Content Service は cross-locale fallback を行わない。

### Decision 009 — Watcher and collection synchronization

- Astro Adapter の初回 `load()` は content root を全走査し、現在有効な locale Entry の集合を確定して Astro Store と同期する。
- dev mode では Astro が提供する `watcher` を使用し、Content Unit 配下の add、change、unlink、directory change を監視する。
- watcher event は短時間 debounce し、直列化された collection rescan を要求する。実行中に追加 event が来た場合は、完了後にもう一度 rescan する。
- v1.0 の正しさの基準は event 単位の部分更新ではなく、rescan 後の完全な集合照合とする。
- rescan では有効 Entry を `parseData()` 後に `store.set()` し、現行の有効 ID 集合に存在しない Store Entry を `store.delete()` する。これにより file 削除、locale の invalid 化、Content Unit rename を stale Entry として残さない。
- watcher listener は1回の Loader lifecycle で重複登録しない。正確な teardown API と hot-reload lifecycle は prototype で確認する。
- production build では watcher に依存せず、初回全同期だけで正しい Store を構築する。

### Decision 010 — Change detection and digest

- Astro Store に登録する Entry は、Store の不要な更新を抑止できる digest を持つ。
- digest は少なくとも Entry の `data`、raw Markdown body、rendered output に影響する入力、および Entry identity に影響する値の変更で変化しなければならない。
- Astro の `generateDigest()` は非暗号学的な変更検知に利用できる。具体的な serialization、対象 byte、digest algorithm は prototype 後に固定する。
- digest の一致は Store update の省略にのみ使用し、削除検出の代わりにはしない。
- Editor の外部変更検出に使う conflict token は Astro Entry digest と別 contract とする。checksum、mtime、または両方の選択は File Writer Specification まで Implementation Deferred とする。

### Decision 011 — Routing boundary

- Route は Repository へ保存せず、locale、collection、Content ID から Route Helper が生成する Derived Value とする。
- 既存日本語 route は `/{collection}/{contentId}` を維持し、英語 route は `/en/{collection}/{contentId}` を v1.0 の基本形とする。
- Loader、Astro Adapter、Query Adapter は route string を生成または返さない。
- Presentation と `getStaticPaths()` は Route Helper と `entry.data.contentId` を使用し、`entry.id` の encoding や path 文字列を識別子として利用しない。
- locale switch は対応 locale の renderable Entry が存在する場合だけ有効化し、cross-locale fallback を行わない。
- route collision は Repository Integrity Validator が Publish blocker として検出する。
- News 等の content link は URL 解析から `entry.id` Map へ逆引きする形を廃止対象とし、正規化された Content Reference と collection-specific lookup を使用する。

### Decision 012 — Placeholder strategy

- 通常運用と Migration の双方で、正規 Content Unit は常に `index.yaml + ja.md + en.md` の3ファイルを持つ。
- EN source が存在しない Migration でも `en.md` を生成し、未翻訳 required field と body に field-specific な予約済み Placeholder Token を設定する。AI 翻訳や JA fallback は行わない。
- 予約 token は `__TODO_EN_TITLE__`、`__TODO_EN_SUMMARY__`、`__TODO_EN_HERO_ALT__`、`__TODO_EN_BODY__` とする。`__TODO_` namespace は通常 content で使用できない。
- Loader と Structural Schema は token を非空の通常文字列として忠実に扱い、変換、削除、fallback を行わない。
- Content Quality Validation は予約 token または `__TODO_` fragment の残存を `content.placeholder.unresolved` Issue として報告する。
- unresolved placeholder があっても Save は許可する。対象 locale が EN の場合は EN Preview を block し、Content Unit 内のいずれかに残る場合は Publish を block する。
- token を削除して空文字にしただけでは Structural Validation を通過しない。required field は有効な非空文字列への置換が必要である。

---

## 5. Core principles

### 5.1 Repository truth

Loader は Repository に存在する値、欠損、構文エラーを隠さない。未完成値を別 locale や既定値で補完しない。

### 5.2 No cross-locale fallback

Loader、Astro Adapter、Preview、および Publish は JA→EN、EN→JA の代替を行わない。Editor が別 locale を参考表示することはできるが、その値を保存、Preview、または Publish data として使用してはならない。

### 5.3 Partial results

Loader は完全な成功か全面失敗かの二択にしない。file ごとの `valid`、`invalid`、`missing` state と raw source を保持する。

### 5.4 Derived state is not stored

`draft`、`ready`、`previewable`、`publishable`、route、formatted date 等は content file に保存しない。必要な layer が source data と Validation result から導出する。

### 5.5 Read path and write path are separate

本仕様の Loader は read path を定義する。Editor の serialize、conflict check、atomic write、および Git 操作は Loader の責務ではない。

---

## 6. Architecture

```text
Repository files
    ↓
Read-only File Adapter
    ↓
Parser
    ↓
Approved Normalizer
    ↓
Structural Schema
    ↓
Content Unit Assembler
    ↓
Loaded Content Unit + Issues
    ├── Validation Engine
    ├── Astro Adapter → Astro Store → Query Adapter → Presentation
    ├── Editor application
    └── Migration verification
```

書き込み経路は独立する。

```text
Editor state
    ↓
Serializer / Structural Validation
    ↓
Conflict-safe File Writer
    ↓
Reload through Content Unit Loader
```

Migration はさらに別経路である。

```text
Legacy entry
    ↓
Migration Mapper / Writer
    ↓
Target files
    ↓
Content Unit Loader + Validation
    ↓
Migration Report
```

---

## 7. Loader responsibilities

### 7.1 Read-only File Adapter

担当するもの:

- collection root と Content Unit directory の安全な列挙
- `index.yaml`、`ja.md`、`en.md` の存在確認
- UTF-8 raw text と file metadata の読み込み
- content root 外、path traversal、symlink escape の拒否

担当しないもの:

- YAML／frontmatter parsing
- Structural Validation
- file write、atomic replacement、conflict resolution
- Git command

Editor 用 File Writer は別 interface とし、Loader の read adapter と実装を共有しても責務を混ぜない。

### 7.2 Parser

- `index.yaml` を YAML として parse する。
- locale Markdown の frontmatter と raw body を分離する。
- syntax error の file、line、column を可能な限り Issue に含める。
- parse に失敗した file の raw source を保持する。
- 1 file の失敗後も同じ Unit の他 file を処理する。

### 7.3 Normalizer

Normalizer は Schema Registry が明示的に許可した legacy input だけを canonical shape へ変換する。意味の推測、翻訳、欠損値の創作、field typo の黙認は行わない。

例:

```text
承認済み legacy `category: interview`
→ `categories: [interview]`

不明値 `categories: int`
→ 推測せず Structural Issue
```

Normalization rule は version 管理し、Migration rule と通常 Loader rule を区別できなければならない。

### 7.4 Structural Validation

共通 Schema module により、単一 file の型、required field の存在、enum、strict object、同一 object 内の制約を検証する。

Journal では少なくとも以下を構造制約とする。

- `date` は有効な `YYYY-MM-DD` string
- `categories` は `interview | essay | report` の1件以上の配列
- `hero.image` は必須、`hero.hero_caption` は任意
- `author`、`credits` は任意かつ同時指定禁止
- Localized field 名は `title`、`summary`、`hero_alt`
- `excerpt`、`featured`、`hero.credit`、Journal SEO field を暗黙に導入しない
- unknown field は error

参照先の存在、画像 file の存在、route collision、Preview／Publish 完成度はここでは判定しない。

### 7.5 Content Unit Assembler

- directory 名から Content ID を確定する。
- Shared と locale ごとの parse／structure state を1つの結果へ構成する。
- raw body、raw source metadata、および Issue を保持する。
- locale fallback、参照解決、route 生成、capability 判定を行わない。

---

## 8. Loader result contract

概念上の最小 contract は次のとおりとする。具体的な型名は実装時に変更できるが、情報を失ってはならない。

```ts
type FileState<T> =
  | { status: "valid"; data: T; raw: string }
  | { status: "invalid"; raw: string; issues: Issue[] }
  | { status: "missing"; issues: Issue[] };

type LocalizedFileState<T> =
  | {
      status: "valid";
      data: T;
      body: string;
      raw: string;
    }
  | { status: "invalid"; raw: string; issues: Issue[] }
  | { status: "missing"; issues: Issue[] };

type LoadedContentUnit<TShared, TLocalized> = {
  collection: CollectionName;
  contentId: string;
  directory: string;
  shared: FileState<TShared>;
  locales: Record<"ja" | "en", LocalizedFileState<TLocalized>>;
  files: FileMetadata[];
  issues: Issue[];
};
```

`incomplete` は Loader の file state としない。構造上有効だが内容が操作要件を満たさない状態は Validation／Capability Evaluator が導出する。

---

## 9. File presence and incomplete units

正規 Content Unit は `index.yaml + ja.md + en.md` の3ファイルで構成する。これは恒常運用モデルである。

ただし、Loader が読み取れる状態と正規状態は同義ではない。`index.yaml` またはいずれかの locale file が欠損していても、directory を認識できる限り部分結果を返す。

| State                | Loader behavior                                  | Architecture meaning                               |
| -------------------- | ------------------------------------------------ | -------------------------------------------------- |
| 3 files valid        | 全 file を返す                                   | 正規構造。操作可否は別途判定                       |
| `en.md` missing      | JA と Shared を返し EN missing Issue             | 不完全な Unit。Migration output としては許容しない |
| `ja.md` missing      | EN と Shared を返し JA missing Issue             | 不完全な Unit                                      |
| `index.yaml` missing | locale raw/parsed result と Shared missing Issue | 中核 Shared data 欠損                              |
| 1 file parse error   | raw source と他 file の結果を返す                | Recoverable Content Error                          |

Migration Generator は `index.yaml + ja.md` だけの Unit を生成せず、EN source がない場合も Placeholder Token 入りの `en.md` を生成する。手動削除や破損による欠損を Loader が部分結果として観測できることは変わらない。

---

## 10. Astro Adapter

Astro Adapter は Loader result のうち構造上有効な Shared と対象 locale を、Astro Content Layer の locale-specific Entry へ変換する。

```text
Loaded Content Unit
    ↓ select one structurally valid locale
Astro Adapter
    ↓ flatten Shared + Localized + identity
parseData()
    ↓
store.set()
```

### 10.1 Responsibilities

- `contentId` と `locale` を Entry data に付与する。
- Shared data と対象 locale data をフラット化する。
- raw Markdown body を Astro rendering pipeline へ接続する。
- 一意な内部 Entry ID を helper で生成する。
- `parseData()` の失敗を Issue 化し、その Entry を登録しない。
- valid locale Entry のみ `store.set()` する。

### 10.2 Non-responsibilities

- 他 locale の値による fallback
- Preview／Publish capability の判定
- Repository reference や asset の解決
- formatted date、exhibition status、display title 等の presentation-derived value
- route policy の決定
- invalid data の修復

### 10.3 Store registration matrix

| Shared          | JA              | EN              | Astro Store                                |
| --------------- | --------------- | --------------- | ------------------------------------------ |
| valid           | valid           | valid           | JA Entry、EN Entry                         |
| valid           | valid           | missing/invalid | JA Entry のみ。Unit Integrity Issue を保持 |
| valid           | missing/invalid | valid           | EN Entry のみ                              |
| missing/invalid | any             | any             | Journal locale Entry は登録不可            |

Store 登録は公開可能性を意味しない。Placeholder を含む構造上有効な Draft Entry も Store へ登録できる。Query Adapter は capability を判定せず、通常サイトの consumer は Site Content Service を通して renderable Entry だけを取得する。

### 10.4 Synchronization contract

初回 load と watcher 後の rescan は、Store を Repository の現在の有効 locale Entry 集合へ収束させる。同一 ID の invalid 化、source file の unlink、Unit rename では旧 Entry を削除する必要がある。`store.clear()` による全面再構築と `store.keys()`／`store.delete()` による集合差分のどちらを採るかは prototype で性能と dev stability を比較するが、stale Entry を残さないことは固定要件である。

Astro 6 の `watcher` は dev mode の filesystem watcher であり、`DataStore` は `set()`、`delete()`、`clear()` を提供するため、この同期方式は API 上実現可能である。ただし listener teardown、event burst、atomic rename、Editor の複数 file write に対する実挙動は prototype で確認する。

---

## 11. Query and route boundary

Consumer は `getCollection("journal")` の結果を直接 locale 判定へ使わず、Query Adapter を利用する目標とする。

```ts
type JournalEntry = CollectionEntry<"journal">;

queryJournalEntries(locale: Locale): Promise<JournalEntry[]>;
findJournalEntry(
  locale: Locale,
  contentId: string,
): Promise<JournalEntry | undefined>;
```

`queryJournalEntries()` は対象 locale の構造上有効な Astro Entry を date 降順、同日では `contentId` 昇順で返す。`findJournalEntry()` は `entry.data.contentId` を基準に単一 Entry を返し、該当なしでは `undefined` とする。Infrastructure Error は隠さない。

Astro 6 の `getCollection()` は collection key から `CollectionEntry<"journal">[]` を推論し、filter callback で `data.locale` を選別できる。`getEntry("journal", id)` は Astro Entry ID による lookup であり、Content ID lookup ではない。したがって、Entry ID encoding を固定するまでは `findJournalEntry()` を `getCollection()` と `entry.data.contentId` の比較で実装してよい。将来、opaque な ID helper を Query Adapter 内部で共有できる場合のみ、公開 contract を変えずに `getEntry()` へ最適化できる。

通常サイトで renderable Entry だけを必要とする consumer は、Query Adapter を直接使わず Site Content Service を使う。

```ts
getRenderableJournalEntries(locale: Locale): Promise<JournalEntry[]>;
getRenderableJournalEntry(
  locale: Locale,
  contentId: string,
): Promise<JournalEntry | undefined>;
```

これらは Query Adapter の API ではない。Site Content Service が Query Adapter の結果へ locale 単位の renderability policy を適用する。Editor の Content Unit Publish capability はこの Service にも置かない。

Journal 一覧の Hero 選択、Home の最大6件、News との統合、年 grouping、および NewsItem／Story View Model への変換は consumer-specific presentation とする。Home の News 画像解決は URL 文字列から `entry.id` Map を直接引く方式を廃止し、正規化された Content Reference と collection-specific lookup を介する。legacy link の移行時だけ Route Parser を境界 adapter として使用できる。Query Adapter 自身は route や画像を解決しない。

Journal route は JA を `/journal/{contentId}`、EN を `/en/journal/{contentId}` とする。Loader と Query Adapter は route string を返さず、Presentation と `getStaticPaths()` が共通 Route Helper を使用する。

---

## 12. Validation boundary

| Concern                        | Owner                           | Loader involvement               |
| ------------------------------ | ------------------------------- | -------------------------------- |
| File access / presence         | File Adapter                    | 結果を返す                       |
| YAML / frontmatter syntax      | Parser                          | Parse Issue を返す               |
| Type / enum / strict fields    | Shared Structural Schema        | Structural Issue を返す          |
| Intra-object constraints       | Shared Structural Schema        | Structural Issue を返す          |
| Unit file completeness         | Unit Integrity Validator        | Loader result を入力に使う       |
| Cross-collection references    | Repository Integrity Validator  | Loader result/index を入力に使う |
| Asset existence                | Repository Integrity Validator  | Loader 外                        |
| Preview eligibility per locale | Preview Validator               | Loader 外                        |
| Editor Publish eligibility     | Publish Validator               | Loader 外                        |
| Save capability                | Editor Capability Evaluator     | Loader 外                        |
| Build policy                   | Astro build / repository policy | Loader 外                        |

`author` と `credits` の排他のように単一 object だけで決まる規則は Structural Schema に置く。Contributor の存在確認は Repository Integrity Validation に置く。

手動編集による commit／push は Editor Publish gate の外にある。Repository validation または CI の build policy をどこまで強制するかは別仕様で決定する。

Placeholder は Structural Validation では有効な非空文字列である。ただし Content Quality Validation は対象値全体だけでなく文字列中の `__TODO_` fragment も検出する。`content.placeholder.unresolved` は EN Preview と Publish の blocker であり、Save blocker ではない。

---

## 13. Error model and recovery

### 13.1 Recoverable Content Error

単一 file または Unit に閉じた parse、type、enum、unknown field、missing file。Loader は Issue と部分結果を返す。

### 13.2 Recoverable Repository Error

Content ID 重複、route collision、asset 欠損、reference 切れ等。Repository Integrity Validator が記録し、他 Unit の読み込みを続行する。

### 13.3 Write Conflict

Editor が読み込んだ後に Repository file が変更された状態。File Writer／Editor が保存を止め、再読込または明示的な解決を要求する。Loader は write conflict を解決しない。

### 13.4 Fatal Infrastructure Error

content root 全体へアクセス不能、Schema Registry 初期化不能、Loader configuration 破損等。安全に scan を継続できないため Loader operation を失敗させる。

Issue の `ruleId`、severity、location、blocked action、および localization contract は未決であり、Issue Model Specification で固定する。

---

## 14. Responsibility boundaries

### Loader

- Repository を読む
- parse、承認済み normalize、Structural Schema 適用を行う
- raw source、部分結果、Issue を返す

### Astro Adapter

- validな Shared＋対象 locale を flat Entry にする
- `parseData()` と Store 登録に接続する
- raw Markdown を Astro rendering pipeline に渡す

### Validation

- Unit／Repository integrity を判定する
- locale 別 Preview と Editor Publish の条件を判定する
- Issue から capability を導出する

### Migration

- legacy data を目標 file structure へ map して書く
- 意味を推測して content を修正しない
- Loader と Validation を再利用して結果を report する
- 過渡的な EN 欠損を Loader の正規モデルへ持ち込まない
- EN source がない場合も予約 Placeholder 入りの `en.md` を生成する

### Editor

- Loader result と Validation result を表示する
- raw Markdown と構造化 field を編集する
- serialize、conflict check、atomic write を専用 write path で行う
- Save、locale Preview、Publish の capability を Validation から受け取る
- Git operation は Publish Adapter に委譲する

---

## 15. Migration constraints

現行 Journal 9件からは英語 content を生成できない。Migration は JA の意味内容を EN にコピー、翻訳、または fallback してはならない。

現行 content には日付／file 名の不一致、重複 placeholder 内容、本文の文字欠落候補、空の inline image alt、hero candidate の不一致候補がある。これらは structural conversion で自動修正せず、Migration Report の manual review item とする。

Migration output は常に `en.md` を含める。EN source がない場合は予約済み Placeholder Token を required localized field と body に設定する。これらは構造上有効だが `content.placeholder.unresolved` により EN Preview と Publish を block する。Migration Generator は AI 翻訳、JA copy、cross-locale fallback を行わない。

---

## 16. Implementation and verification requirements

Journal 1件の prototype で、少なくとも次を確認してから全件移行する。

- directory 名から Content ID が安定して得られること
- Shared と locale Schema を共通 module から Astro／Loader が利用できること
- JA／EN Entry ID の一意性と `getEntry()` の挙動
- `parseData()`、Store update、dev cache、watch の挙動
- raw Markdown が Astro `render(entry)` 相当で描画できること
- JA valid／EN invalid のとき JA Entry のみ登録でき、EN Placeholder のときは両 locale Entry を登録できること
- Query Adapter 後も Journal 一覧、詳細、Home Stories、News 統合、画像解決が成立すること
- Query Adapter が `CollectionEntry<"journal">` の schema-derived type を維持し、locale／Content ID filter と既定 sort だけを担当すること
- Site Content Service の renderability filter と Editor Publish capability が独立して検証できること
- 日本語 route `/journal/{contentId}` が維持されること
- 英語 route `/en/journal/{contentId}` が Route Helper から生成され、`entry.id` encoding に依存しないこと
- watcher event burst と複数 file write を debounce／直列化し、削除・rename・valid→invalid 後に stale Entry が残らないこと
- digest が data または body の変更で変化し、同一 digest の Store update を省略できること
- Placeholder が Structural Validation と Save を通り、EN Preview と Publish を block すること
- `astro check` と production build が成功すること
- invalid YAML／frontmatter、unknown field、missing file で部分結果と raw source が保持されること
- external edit 後の Save が自動上書きされないこと

初期実装では高度な cache、自動 merge、自動修復、plugin system、多言語追加を対象外とする。

---

## 17. Unresolved items

以下は v1.0 Draft で意図的に未固定とする。

1. **Astro Entry ID encoding** — locale と Content ID から作ることだけを固定し、区切り文字等は prototype 後に決定する。
2. **Issue Model** — rule taxonomy、severity、source range、blocked action、message localization を別仕様で決定する。
3. **Watcher lifecycle details** — listener teardown、debounce interval、full clear と set-diff の選択、atomic rename の挙動を prototype 後に決定する。
4. **Digest serialization and Editor conflict token** — Astro digest の正規化対象と、File Writer が checksum、mtime、または両方を使うかを各実装仕様で決定する。
5. **Content Reference migration** — 現行 News `link` を正規 Content Reference へ移す時期と legacy Route Parser の廃止条件を決定する。
6. **Placeholder registry expansion** — Journal 以外の collection で必要な field-specific token と、自由本文に対する fragment 検出の詳細を Validation Specification で決定する。
7. **Operation rules** — Placeholder 以外の Save、locale Preview、Editor Publish の collection 別必須条件を Validation／Capability Specification で決定する。
8. **Build enforcement** — 手動 commit に対する repository-wide validation と CI failure policy を別途決定する。

これらは Loader の責務境界を変更しない限り、本仕様の実装を段階的に進めることを妨げない。

---

## 18. Acceptance criteria

本仕様は次を満たす実装の基準とする。

- Repository の保存構造が Presentation Layer へ漏れない。
- Loader、Astro Adapter、Validation、Migration、Editor の責務が重複しない。
- 1 file の破損で他 Unit または他 locale の読み込みを失わない。
- raw source を失わずに Editor で復旧できる。
- cross-locale fallback が存在しない。
- Astro Store は構造上有効な locale Entry のみを保持する。
- Content ID と既存日本語 URL の互換性を維持できる。
- Schema と TypeScript 型が用途別に乖離しない。
- Migration の一時的例外が恒常 Loader model を弱めない。

---

## 19. Decision record

| Decision               | Status                                    | Summary                                                                   |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| 001 Content ID         | Fixed                                     | Directory name、file 内へ重複保存しない                                   |
| 002 Schema sharing     | Fixed                                     | 共通 Structural Schema と推論型、operation rule は分離                    |
| 003 Astro integration  | Fixed                                     | 1 Unit → locale Entry、`parseData()` 後に valid Entry のみ登録            |
| 004 Consumer isolation | Fixed                                     | Shared＋Localized を flat Entry 化し、Repository 構造を隠す               |
| 005 Markdown boundary  | Fixed                                     | Loader は raw Markdown、render は Astro 境界                              |
| 006 Error recovery     | Fixed                                     | 部分結果、raw source、recoverable／fatal の分離                           |
| 008 Query Adapter      | Fixed                                     | 純粋な取得境界、renderability は Site Content Service                     |
| 009 Watcher            | Fixed                                     | debounce 後の rescan と Store 集合同期、stale Entry 削除                  |
| 010 Change detection   | Fixed with implementation detail deferred | Astro digest 要件は固定、具体方式と Editor conflict token は保留          |
| 011 Routing            | Fixed                                     | Route Helper、Content ID 基準、JA／EN route、`entry.id` 非依存            |
| 012 Placeholder        | Fixed                                     | 常に `en.md`、予約 token は structural valid、EN Preview／Publish blocker |

本書が Draft である理由は Decisions 001–012 が未承認だからではなく、Section 17 の実装 contract が prototype または別仕様を必要とするためである。
