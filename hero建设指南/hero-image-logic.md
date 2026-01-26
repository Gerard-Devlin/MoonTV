# 首页 Hero 头图获取逻辑

本文档描述首页（Home Page）Hero 部分的头图数据来源、渲染路径与图片代理流程，便于定位问题与二次开发。

## 入口与渲染链路

1. **首页入口组件**
    - 文件：`app/page.tsx`
    - 逻辑：调用 `useHomeData()` 获取首页数据；将 `heroMovies` 与 `heroDataList` 传入 `HeroBanner`。

2. **Hero 组件渲染**
    - 文件：`components/home/HeroBanner.tsx`
    - 逻辑：根据 `heroMovies` 和 `heroDataList` 渲染轮播背景图、标题、评分、分类、简介等。
    - 图片使用规则：
        - 移动端使用竖图 `poster_vertical`。
        - PC 端使用横图 `poster_horizontal`。

## 数据获取与转换

1. **数据 Hook**
    - 文件：`hooks/useHomeData.ts`
    - 逻辑：
        - 使用 SWR 拉取 Hero 数据 `getHeroMovies()`。
        - 将服务端返回结构转换为组件所需的 `heroMovies`（电影基础信息）与 `heroDataList`（海报与简介）。

2. **API 请求**
    - 文件：`lib/douban-service.ts`
    - 函数：`getHeroMovies()`
    - 实际请求：`GET ${NEXT_PUBLIC_DOUBAN_API_URL}/api/v1/hero`
    - 返回字段：包含 `poster_horizontal`、`poster_vertical`、`description`、`genres`、`title` 等。

## 图片地址生成与代理

1. **图片 URL 处理**
    - 文件：`lib/utils/image-utils.ts`
    - 函数：`getImageUrl(imageUrl: string)`
    - 逻辑：
        - 若 `imageUrl` 为空，返回默认占位图 `/movie-default-bg.jpg`（位于 `public`）。
        - 否则将原图地址封装为 `/api/image-proxy?url=ENCODED_URL`。

2. **图片代理路由**
    - 文件：`app/api/image-proxy/route.ts`
    - 逻辑：
        - 读取 query 参数 `url`。
        - 先通过代理池（`wsrv.link0.me`）并行/快速尝试拉取图片。
        - 代理全部失败时，直接请求原图地址（带 UA 与 Referer）。
        - 成功后返回图片二进制，并设置长缓存：`Cache-Control: public, max-age=31536000, immutable`。

## 关键流程一览

1. 首页渲染调用 `useHomeData()`。
2. `useHomeData()` 调 `getHeroMovies()` 请求后端 `/api/v1/hero`。
3. `HeroBanner` 使用 `heroDataList` 中的 `poster_horizontal` / `poster_vertical`。
4. `getImageUrl()` 将图片转为 `/api/image-proxy` 代理地址。
5. `/api/image-proxy` 负责真实拉取并缓存图片，返回给前端显示。

## 关键代码摘录

> 下面是“头图从哪里获取 + 如何获取”的关键实现片段，便于快速定位。

### 1) Hero 数据来源（地址与方法）

文件：`lib/douban-service.ts`

```ts
const DOUBAN_API_URL =
    process.env.NEXT_PUBLIC_DOUBAN_API_URL ||
    "https://iamyourfather.link0.me";

export async function getHeroMovies(): Promise<
    HeroMovie[]
> {
    return fetchFromService<HeroMovie[]>(
        "/api/v1/hero",
    );
}
```

实际请求地址：  
`GET ${NEXT_PUBLIC_DOUBAN_API_URL}/api/v1/hero`

### 2) 首页数据 Hook（取到 Hero 并转成组件需要的结构）

文件：`hooks/useHomeData.ts`

```ts
const { data: heroData } = useSWR(
    "home-hero",
    getHeroMovies,
);

const { heroMovies, heroDataList } =
    useMemo(() => {
        if (
            !heroData ||
            !Array.isArray(heroData)
        ) {
            return {
                heroMovies: [],
                heroDataList: [],
            };
        }

        const heroMoviesList = heroData.map(
            (hero) => ({
                id: hero.id,
                title: hero.title,
                cover: hero.cover || "",
                url: hero.url || "",
                rate: hero.rate || "",
                episode_info:
                    hero.episode_info || "",
                cover_x: 0,
                cover_y: 0,
                playable: false,
                is_new: false,
            }),
        );

        const heroDataArray = heroData.map(
            (hero) => ({
                poster_horizontal:
                    hero.poster_horizontal,
                poster_vertical:
                    hero.poster_vertical,
                description: hero.description,
                genres: hero.genres,
            }),
        );

        return {
            heroMovies: heroMoviesList,
            heroDataList: heroDataArray,
        };
    }, [heroData]);
```

### 3) Hero 组件里取图（移动端/PC）

文件：`components/home/HeroBanner.tsx`

```tsx
<img
  src={getImageUrl(heroData.poster_vertical)}
  alt={movie.title}
  className="block md:hidden w-full h-full object-cover"
/>

<img
  src={getImageUrl(heroData.poster_horizontal)}
  alt={movie.title}
  className="hidden md:block w-full h-full object-cover object-top"
/>
```

### 4) 图片 URL 处理（走本地代理）

文件：`lib/utils/image-utils.ts`

```ts
const DEFAULT_PLACEHOLDER =
    "/movie-default-bg.jpg";

export function getImageUrl(
    imageUrl: string,
): string {
    if (!imageUrl || imageUrl.trim() === "") {
        return DEFAULT_PLACEHOLDER;
    }
    return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}
```

### 5) 图片代理路由（真实拉取并缓存）

文件：`app/api/image-proxy/route.ts`

```ts
export async function GET(request: NextRequest) {
    const url =
        request.nextUrl.searchParams.get("url");
    if (!url) {
        return NextResponse.json(
            {
                error: "URL parameter is required",
            },
            { status: 400 },
        );
    }

    const response =
        await fetchImageWithProxy(url);
    const imageBuffer =
        await response.arrayBuffer();
    const contentType =
        response.headers.get("content-type") ||
        "image/jpeg";

    return new NextResponse(imageBuffer, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Cache-Control":
                "public, max-age=31536000, immutable",
        },
    });
}
```

## 文件索引

- 首页入口：`app/page.tsx`
- Hero 组件：`components/home/HeroBanner.tsx`
- 数据 Hook：`hooks/useHomeData.ts`
- Douban API：`lib/douban-service.ts`
- 图片工具：`lib/utils/image-utils.ts`
- 图片代理：`app/api/image-proxy/route.ts`

## 常见排查点

- Hero 为空：检查 `/api/v1/hero` 返回数据是否为空或失败。
- 图片不显示：检查 `poster_horizontal` / `poster_vertical` 是否为空，或 `image-proxy` 是否报错。
- 占位图出现：说明服务端返回海报为空或字段缺失。
