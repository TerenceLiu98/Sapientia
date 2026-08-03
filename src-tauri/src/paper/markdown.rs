use super::SourceBlock;

const PAPER_BLOCK_ANCHOR_PREFIX: &str = "tolaria:block";
const MATH_BLOCK_TOKEN_PREFIX: &str = "@@TOLARIA_MATH_BLOCK:";
const MATH_INLINE_TOKEN_PREFIX: &str = "@@TOLARIA_MATH_INLINE:";
const MATH_TOKEN_SUFFIX: &str = "@@";

pub fn paper_block_anchor(block: &SourceBlock) -> String {
    format!(
        "<!-- {PAPER_BLOCK_ANCHOR_PREFIX} id=\"{}\" page=\"{}\" kind=\"{}\" hash=\"{}\" -->",
        escape_html_attr(&block.id),
        block.page,
        escape_html_attr(&block.kind),
        escape_html_attr(&block.hash),
    )
}

pub fn paper_markdown_from_blocks(blocks: &[SourceBlock]) -> String {
    let mut content = String::new();
    for block in blocks {
        let body = markdown_for_block(block);
        if body.trim().is_empty() {
            continue;
        }
        if !content.is_empty() {
            content.push('\n');
        }
        content.push_str(&paper_block_anchor(block));
        content.push('\n');
        content.push_str(body.trim());
        content.push_str("\n\n");
    }
    content
}

pub fn paper_note_with_markdown_body(existing_content: &str, body: &str) -> String {
    let body = ensure_trailing_newline(body);
    frontmatter_end(existing_content)
        .map(|end| format!("{}{}", &existing_content[..end], body))
        .unwrap_or(body)
}

fn markdown_for_block(block: &SourceBlock) -> String {
    let kind = normalized_kind(block.kind.as_str());
    let text = block_text(block);
    match kind.as_str() {
        "title" => format!("# {text}"),
        "heading" => format!("## {text}"),
        "equation" => {
            let latex = normalize_paper_math_text(text.as_str());
            format!("$$\n{latex}\n$$")
        }
        "caption" => format!("*{text}*"),
        "figure" => figure_markdown(block, text.as_str()),
        "table" => table_markdown(block, text.as_str()),
        _ if block_has_asset(block) => figure_markdown(block, text.as_str()),
        _ => text,
    }
}

fn block_has_asset(block: &SourceBlock) -> bool {
    block
        .asset_path
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

fn figure_markdown(block: &SourceBlock, text: &str) -> String {
    let caption = block
        .caption
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(asset_path) = block
        .asset_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let alt = caption
            .or_else(|| meaningful_asset_alt(text, "figure"))
            .unwrap_or("Figure");
        let image = format!("![{}]({})", escape_markdown_image_alt(alt), asset_path);
        return match caption {
            Some(caption) if caption != alt => format!("{image}\n\n*{caption}*"),
            Some(caption) if caption == alt => format!("{image}\n\n*{caption}*"),
            _ => image,
        };
    }
    match (text.is_empty(), caption) {
        (true, Some(caption)) => format!("**Figure.** {caption}"),
        (false, Some(caption)) if caption != text => format!("{text}\n\n*{caption}*"),
        _ => text.to_string(),
    }
}

fn meaningful_asset_alt<'a>(text: &'a str, fallback_kind: &str) -> Option<&'a str> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case(fallback_kind)
        || matches!(trimmed, "paragraph" | "chart" | "diagram")
    {
        None
    } else {
        Some(trimmed)
    }
}

fn table_markdown(block: &SourceBlock, text: &str) -> String {
    let table = normalize_table_markdown(text);
    let caption = block
        .caption
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(asset_path) = block
        .asset_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let alt = caption
            .or_else(|| {
                let text = text.trim();
                (!text.is_empty() && text != "table").then_some(text)
            })
            .unwrap_or("Table");
        let image = format!("![{}]({})", escape_markdown_image_alt(alt), asset_path);
        let mut parts = vec![image];
        if let Some(caption) = caption {
            parts.push(format!("*{caption}*"));
        }
        if !table.is_empty()
            && table != "table"
            && caption.map_or(true, |caption| !table.contains(caption))
        {
            parts.push(table);
        }
        return parts.join("\n\n");
    }
    match caption {
        Some(caption) if !table.contains(caption) => format!("{table}\n\n*{caption}*"),
        _ => table,
    }
}

fn block_text(block: &SourceBlock) -> String {
    block
        .text
        .as_deref()
        .or(block.caption.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(block.kind.as_str())
        .to_string()
}

fn normalize_paper_math_text(text: &str) -> String {
    let trimmed = text.trim();
    if let Some(decoded) = decode_math_token(trimmed, MATH_BLOCK_TOKEN_PREFIX)
        .or_else(|| decode_math_token(trimmed, MATH_INLINE_TOKEN_PREFIX))
    {
        return polish_latex(strip_math_delimiters(decoded.trim()));
    }

    let without_sentinels = trimmed
        .lines()
        .filter(|line| !is_leaked_math_sentinel_line(line))
        .collect::<Vec<_>>()
        .join("\n");
    polish_latex(strip_math_delimiters(without_sentinels.trim()))
}

fn decode_math_token(text: &str, prefix: &str) -> Option<String> {
    text.strip_prefix(prefix)
        .and_then(|value| value.strip_suffix(MATH_TOKEN_SUFFIX))
        .map(percent_decode)
}

fn percent_decode(value: &str) -> String {
    let mut bytes = Vec::with_capacity(value.len());
    let source = value.as_bytes();
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' && index + 2 < source.len() {
            let high = hex_value(source[index + 1]);
            let low = hex_value(source[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                bytes.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        bytes.push(source[index]);
        index += 1;
    }
    String::from_utf8(bytes).unwrap_or_else(|_| value.to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn is_leaked_math_sentinel_line(line: &str) -> bool {
    matches!(
        line.trim(),
        MATH_TOKEN_SUFFIX
            | MATH_BLOCK_TOKEN_PREFIX
            | MATH_INLINE_TOKEN_PREFIX
            | "TOLARIA_MATH_BLOCK:"
            | "TOLARIA_MATH_INLINE:"
    )
}

fn strip_math_delimiters(text: &str) -> &str {
    let trimmed = text.trim();
    if let Some(inner) = trimmed
        .strip_prefix("$$")
        .and_then(|value| value.strip_suffix("$$"))
    {
        return inner.trim();
    }
    if let Some(inner) = trimmed
        .strip_prefix("\\[")
        .and_then(|value| value.strip_suffix("\\]"))
    {
        return inner.trim();
    }
    trimmed
}

fn polish_latex(text: &str) -> String {
    text.replace(" _ ", "_")
        .replace(" ^ ", "^")
        .replace("\\text {", "\\text{")
        .replace("\\mathrm {", "\\mathrm{")
        .replace("\\mathbf {", "\\mathbf{")
        .replace("{ ", "{")
        .replace(" }", "}")
}

fn normalize_table_markdown(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.contains('|') {
        return trimmed.to_string();
    }

    let rows = trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let cells = line
                .split('\t')
                .map(str::trim)
                .filter(|cell| !cell.is_empty())
                .collect::<Vec<_>>();
            (cells.len() > 1).then_some(cells)
        })
        .collect::<Vec<_>>();
    if rows.len() < 2 {
        return trimmed.to_string();
    }

    let header = format!("| {} |", rows[0].join(" | "));
    let separator = format!("| {} |", vec!["---"; rows[0].len()].join(" | "));
    let body = rows
        .iter()
        .skip(1)
        .map(|row| format!("| {} |", row.join(" | ")))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{header}\n{separator}\n{body}")
}

fn escape_markdown_image_alt(value: &str) -> String {
    value.replace('[', "\\[").replace(']', "\\]")
}

fn normalized_kind(kind: &str) -> String {
    match kind.trim().to_lowercase().as_str() {
        "title" => "title".to_string(),
        "heading" | "header" => "heading".to_string(),
        "figure" | "image" | "chart" | "diagram" => "figure".to_string(),
        "table" => "table".to_string(),
        "equation" | "formula" | "interline_equation" | "inline_equation" => "equation".to_string(),
        "caption" | "image_caption" | "table_caption" => "caption".to_string(),
        _ => "paragraph".to_string(),
    }
}

fn frontmatter_end(content: &str) -> Option<usize> {
    let (after_open, opening_len, line_ending_len) =
        if let Some(after_open) = content.strip_prefix("---\n") {
            (after_open, 4, 1)
        } else {
            let after_open = content.strip_prefix("---\r\n")?;
            (after_open, 5, 2)
        };
    let close = if line_ending_len == 2 {
        "\r\n---"
    } else {
        "\n---"
    };
    let close_start = after_open.find(close)?;
    let mut end = opening_len + close_start + close.len();
    if content[end..].starts_with("\r\n") {
        end += 2;
    } else if content[end..].starts_with('\n') {
        end += 1;
    }
    Some(end)
}

fn ensure_trailing_newline(value: &str) -> String {
    if value.ends_with('\n') {
        value.to_string()
    } else {
        format!("{value}\n")
    }
}

fn escape_html_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn block(id: &str, kind: &str, text: &str) -> SourceBlock {
        SourceBlock {
            id: id.to_string(),
            paper_id: "paper-1".to_string(),
            kind: kind.to_string(),
            page: 1,
            hash: format!("sha256:{id}"),
            text: Some(text.to_string()),
            caption: None,
            bbox: None,
            section: None,
            order: None,
            source_asset: Some("source.pdf".to_string()),
            asset_path: None,
            confidence: None,
            parser: Some("fixture".to_string()),
            extra: BTreeMap::from([("raw".to_string(), json!("kept"))]),
        }
    }

    fn block_with_asset(id: &str, kind: &str, text: &str, asset_path: &str) -> SourceBlock {
        SourceBlock {
            asset_path: Some(asset_path.to_string()),
            caption: Some("Figure 1. Model overview".to_string()),
            ..block(id, kind, text)
        }
    }

    fn block_with_caption_and_asset(
        id: &str,
        kind: &str,
        text: &str,
        caption: &str,
        asset_path: &str,
    ) -> SourceBlock {
        SourceBlock {
            asset_path: Some(asset_path.to_string()),
            caption: Some(caption.to_string()),
            ..block(id, kind, text)
        }
    }

    #[test]
    fn renders_source_blocks_as_markdown_with_hidden_anchors() {
        let markdown = paper_markdown_from_blocks(&[
            block("b0001", "title", "Attention Is All You Need"),
            block("b0002", "paragraph", "The Transformer is parallel."),
        ]);

        assert!(markdown.contains(
            "<!-- tolaria:block id=\"b0001\" page=\"1\" kind=\"title\" hash=\"sha256:b0001\" -->"
        ));
        assert!(markdown.contains("# Attention Is All You Need"));
        assert!(markdown.contains("<!-- tolaria:block id=\"b0002\" page=\"1\" kind=\"paragraph\" hash=\"sha256:b0002\" -->"));
        assert!(markdown.contains("The Transformer is parallel."));
    }

    #[test]
    fn replaces_only_markdown_body_after_frontmatter() {
        let content = "---\ntype: Paper\n---\n# Old\n";
        let updated = paper_note_with_markdown_body(content, "# New\n");

        assert_eq!(updated, "---\ntype: Paper\n---\n# New\n");
    }

    #[test]
    fn renders_equation_blocks_as_plain_display_math() {
        let markdown = paper_markdown_from_blocks(&[block(
            "b0001",
            "equation",
            "@@\nz = f _ {\\text { Encoder }} (x)\n@@TOLARIA_MATH_BLOCK:",
        )]);

        assert!(markdown.contains("$$\nz = f_{\\text{Encoder}} (x)\n$$"));
        assert!(!markdown.contains("TOLARIA_MATH_BLOCK"));
        assert!(!markdown.contains("@@"));
    }

    #[test]
    fn decodes_internal_math_tokens_before_writing_paper_markdown() {
        let markdown = paper_markdown_from_blocks(&[block(
            "b0001",
            "equation",
            "@@TOLARIA_MATH_BLOCK:%5Cfrac%7B1%7D%7B2%7D@@",
        )]);

        assert!(markdown.contains("$$\n\\frac{1}{2}\n$$"));
        assert!(!markdown.contains("TOLARIA_MATH_BLOCK"));
    }

    #[test]
    fn renders_figure_assets_as_markdown_images_with_captions() {
        let markdown = paper_markdown_from_blocks(&[block_with_asset(
            "b0001",
            "figure",
            "",
            "assets/figure-0001.png",
        )]);

        assert!(markdown.contains("![Figure 1. Model overview](assets/figure-0001.png)"));
        assert!(markdown.contains("*Figure 1. Model overview*"));
    }

    #[test]
    fn converts_tabular_text_to_markdown_table_when_needed() {
        let markdown =
            paper_markdown_from_blocks(&[block("b0001", "table", "Method\tScore\nKAN\t0.92")]);

        assert!(markdown.contains("| Method | Score |"));
        assert!(markdown.contains("| --- | --- |"));
        assert!(markdown.contains("| KAN | 0.92 |"));
    }

    #[test]
    fn renders_table_assets_as_markdown_images_with_captions() {
        let markdown = paper_markdown_from_blocks(&[block_with_caption_and_asset(
            "b0001",
            "table",
            "| Method | Score |",
            "Table 1. Accuracy",
            "assets/table-0001.png",
        )]);

        assert!(markdown.contains("![Table 1. Accuracy](assets/table-0001.png)"));
        assert!(markdown.contains("*Table 1. Accuracy*"));
        assert!(markdown.contains("| Method | Score |"));
    }

    #[test]
    fn renders_image_only_table_assets_with_clean_alt_label() {
        let markdown = paper_markdown_from_blocks(&[SourceBlock {
            asset_path: Some("assets/table.jpg".to_string()),
            ..block("b0001", "table", "")
        }]);

        assert!(markdown.contains("![Table](assets/table.jpg)"));
        assert!(!markdown.contains("\n\ntable"));
    }

    #[test]
    fn renders_unknown_asset_blocks_as_markdown_images() {
        let markdown = paper_markdown_from_blocks(&[SourceBlock {
            asset_path: Some("assets/chart.jpg".to_string()),
            ..block("b0001", "paragraph", "")
        }]);

        assert!(markdown.contains("![Figure](assets/chart.jpg)"));
        assert!(!markdown.contains("\nparagraph"));
    }
}
