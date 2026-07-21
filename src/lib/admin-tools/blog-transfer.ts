import {
  booleanValue,
  firstValue,
  graphqlData,
  listValue,
  optionalText,
  pause,
  slugify,
  userErrorMessage,
  type AdminClient,
  type DataRow,
} from "./adminTools";

interface BlogNode {
  id: string;
  title: string;
  handle: string;
  commentPolicy: string;
  templateSuffix: string | null;
  articles: {
    nodes: Array<{
      id: string;
      title: string;
      handle: string;
      body: string;
      summary: string | null;
      tags: string[];
      isPublished: boolean;
      publishedAt: string | null;
      createdAt: string;
      updatedAt: string;
      templateSuffix: string | null;
      author: { name: string };
      image: { url: string; altText: string | null } | null;
      seo: { title: string | null; description: string | null };
    }>;
  };
}

export async function exportBlogs(admin: AdminClient, limit = 10000): Promise<DataRow[]> {
  const rows: DataRow[] = [];
  let cursor: string | null = null;
  while (rows.length < limit) {
    const data = await graphqlData<{
      blogs: {
        nodes: BlogNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      admin,
      `#graphql
        query BlogExport($first: Int!, $after: String) {
          blogs(first: $first, after: $after) {
            nodes {
              id title handle commentPolicy templateSuffix
              articles(first: 250, sortKey: UPDATED_AT, reverse: true) {
                nodes {
                  id title handle body summary tags isPublished publishedAt createdAt updatedAt templateSuffix
                  author { name }
                  image { url altText }
                  seo { title description }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { first: 50, after: cursor },
    );

    for (const blog of data.blogs.nodes) {
      if (!blog.articles.nodes.length) {
        rows.push({
          "Blog ID": blog.id,
          "Blog Title": blog.title,
          "Blog Handle": blog.handle,
          "Comment Policy": blog.commentPolicy,
          "Blog Template Suffix": blog.templateSuffix || "",
          "Article ID": "",
          "Article Title": "",
        });
      }
      for (const article of blog.articles.nodes) {
        rows.push({
          "Blog ID": blog.id,
          "Blog Title": blog.title,
          "Blog Handle": blog.handle,
          "Comment Policy": blog.commentPolicy,
          "Blog Template Suffix": blog.templateSuffix || "",
          "Article ID": article.id,
          "Article Title": article.title,
          "Article Handle": article.handle,
          "Body (HTML)": article.body,
          Summary: article.summary || "",
          Author: article.author.name,
          Tags: article.tags.join(", "),
          Published: article.isPublished,
          "Publish Date": article.publishedAt || "",
          "Article Template Suffix": article.templateSuffix || "",
          "Image URL": article.image?.url || "",
          "Image Alt Text": article.image?.altText || "",
          "SEO Title": article.seo.title || "",
          "SEO Description": article.seo.description || "",
          "Created At": article.createdAt,
          "Updated At": article.updatedAt,
        });
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }

    if (!data.blogs.pageInfo.hasNextPage || !data.blogs.pageInfo.endCursor) break;
    cursor = data.blogs.pageInfo.endCursor;
  }
  return rows;
}

async function findBlog(admin: AdminClient, handle: string): Promise<BlogNode | null> {
  const data = await graphqlData<{
    blogs: { nodes: BlogNode[] };
  }>(
    admin,
    `#graphql
      query FindBlog($query: String!) {
        blogs(first: 5, query: $query) {
          nodes {
            id title handle commentPolicy templateSuffix
            articles(first: 250) {
              nodes {
                id title handle body summary tags isPublished publishedAt createdAt updatedAt templateSuffix
                author { name }
                image { url altText }
                seo { title description }
              }
            }
          }
        }
      }
    `,
    { query: `handle:${JSON.stringify(handle)}` },
  );
  return data.blogs.nodes.find((item) => item.handle === handle) || data.blogs.nodes[0] || null;
}

async function createBlog(admin: AdminClient, row: DataRow): Promise<BlogNode> {
  const title = optionalText(firstValue(row, ["Blog Title", "Blog"]));
  if (!title) throw new Error("Blog Title is required.");
  const handle = optionalText(firstValue(row, ["Blog Handle"])) || slugify(title);
  const data = await graphqlData<{
    blogCreate: {
      blog: BlogNode | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation BlogImportCreate($blog: BlogCreateInput!) {
        blogCreate(blog: $blog) {
          blog { id title handle commentPolicy templateSuffix articles(first: 1) { nodes { id } } }
          userErrors { field message }
        }
      }
    `,
    {
      blog: {
        title,
        handle,
        commentPolicy: optionalText(firstValue(row, ["Comment Policy"])) || "MODERATED",
        templateSuffix: optionalText(firstValue(row, ["Blog Template Suffix"])) || null,
      },
    },
  );
  const message = userErrorMessage(data.blogCreate.userErrors);
  if (message) throw new Error(message);
  if (!data.blogCreate.blog) throw new Error("Shopify did not return the created blog.");
  return data.blogCreate.blog;
}

export async function importBlogs(
  admin: AdminClient,
  rows: DataRow[],
  mode: "create" | "update" | "upsert",
): Promise<{ total: number; blogsCreated: number; articlesCreated: number; articlesUpdated: number; skipped: number; failed: number; errors: string[] }> {
  const result = {
    total: rows.length,
    blogsCreated: 0,
    articlesCreated: 0,
    articlesUpdated: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };
  const blogCache = new Map<string, BlogNode>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const blogTitle = optionalText(firstValue(row, ["Blog Title", "Blog"]));
    const blogHandle = optionalText(firstValue(row, ["Blog Handle"])) || slugify(blogTitle);
    if (!blogHandle) {
      result.skipped += 1;
      result.errors.push(`Row ${index + 2}: Blog Title or Blog Handle is required.`);
      continue;
    }

    try {
      let blog = blogCache.get(blogHandle) || await findBlog(admin, blogHandle);
      if (!blog) {
        if (mode === "update") {
          result.skipped += 1;
          result.errors.push(`Row ${index + 2}: Blog ${blogHandle} was not found.`);
          continue;
        }
        blog = await createBlog(admin, row);
        result.blogsCreated += 1;
      }
      blogCache.set(blogHandle, blog);

      const articleTitle = optionalText(firstValue(row, ["Article Title", "Title"]));
      if (!articleTitle) continue;
      const articleHandle = optionalText(firstValue(row, ["Article Handle"])) || slugify(articleTitle);
      const existingId = optionalText(firstValue(row, ["Article ID"])) ||
        blog.articles?.nodes?.find((item) => item.handle === articleHandle)?.id || "";

      if (mode === "create" && existingId) {
        result.skipped += 1;
        continue;
      }
      if (mode === "update" && !existingId) {
        result.skipped += 1;
        result.errors.push(`Row ${index + 2}: Article ${articleHandle} was not found.`);
        continue;
      }

      const article: Record<string, unknown> = {
        title: articleTitle,
        handle: articleHandle,
        body: optionalText(firstValue(row, ["Body (HTML)", "Body", "Content"])),
        summary: optionalText(firstValue(row, ["Summary"])),
        author: { name: optionalText(firstValue(row, ["Author"])) || "Shopify Admin" },
        tags: listValue(firstValue(row, ["Tags"])),
        isPublished: booleanValue(firstValue(row, ["Published", "Is Published"]), true),
        publishDate: optionalText(firstValue(row, ["Publish Date", "Published At"])) || undefined,
        templateSuffix: optionalText(firstValue(row, ["Article Template Suffix"])) || null,
      };
      const imageUrl = optionalText(firstValue(row, ["Image URL", "Image Src"]));
      if (imageUrl) article.image = {
        url: imageUrl,
        altText: optionalText(firstValue(row, ["Image Alt Text"])),
      };
      const seoTitle = optionalText(firstValue(row, ["SEO Title"]));
      const seoDescription = optionalText(firstValue(row, ["SEO Description"]));
      if (seoTitle || seoDescription) article.seo = { title: seoTitle || undefined, description: seoDescription || undefined };

      if (existingId) {
        const data = await graphqlData<{
          articleUpdate: { article: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
        }>(
          admin,
          `#graphql
            mutation BlogImportUpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
              articleUpdate(id: $id, article: $article) {
                article { id }
                userErrors { field message }
              }
            }
          `,
          { id: existingId, article },
        );
        const message = userErrorMessage(data.articleUpdate.userErrors);
        if (message) throw new Error(message);
        result.articlesUpdated += 1;
      } else {
        const data = await graphqlData<{
          articleCreate: { article: { id: string } | null; userErrors: Array<{ field?: string[]; message: string }> };
        }>(
          admin,
          `#graphql
            mutation BlogImportCreateArticle($article: ArticleCreateInput!) {
              articleCreate(article: $article) {
                article { id }
                userErrors { field message }
              }
            }
          `,
          { article: { ...article, blogId: blog.id } },
        );
        const message = userErrorMessage(data.articleCreate.userErrors);
        if (message) throw new Error(message);
        result.articlesCreated += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await pause(120);
  }

  return result;
}
