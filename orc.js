// Array de produtos com código e descrição
const produtos = [
    { codigo: '001', descricao: 'Orçamento A' },
    { codigo: '002', descricao: 'Orçamento B' },
    { codigo: '003', descricao: 'Orçamento C' },
    { codigo: '004', descricao: 'Orçamento D' },
    { codigo: '005', descricao: 'Orçamento E' }
];

// Função para renderizar a lista de produtos
function renderizarProdutos() {
    const lista = document.getElementById('product-list');
    produtos.forEach(produto => {
        const item = document.createElement('li');
        item.classList.add('product-item');
        item.innerHTML = `
            <span class="codigo">${produto.codigo}</span>
            <span class="descricao">${produto.descricao}</span>
            <button class="scan-btn" onclick="abrirPagina('${produto.codigo}')">Abrir</button>
        `;
        lista.appendChild(item);
    });
}

// Função para abrir outra página HTML
function abrirPagina(codigoProduto) {
    const novaPagina = `pagina_${codigoProduto}.html`; // Nome do arquivo HTML
    window.location.href = novaPagina;
}

// Renderizar produtos na tela ao carregar a página
document.addEventListener('DOMContentLoaded', renderizarProdutos);
