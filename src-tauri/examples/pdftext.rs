//! Dev tool: print the text pdf-extract sees in a PDF, for building extractor fixtures.
//! Usage: cargo run --example pdftext -- <file.pdf>
fn main() {
    let path = std::env::args().nth(1).expect("usage: pdftext <file.pdf>");
    let bytes = std::fs::read(path).expect("read file");
    print!("{}", pdf_extract::extract_text_from_mem(&bytes).expect("extract text"));
}
