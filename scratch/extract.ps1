$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc1 = $word.Documents.Open('C:\Users\Sistemas2\Downloads\000001-CHS268-ANUAL GNV.doc')
$doc1.Content.Text | Out-File 'C:\Users\Sistemas2\Desktop\farenet nuevo proyecto\farenetBackend\scratch\gnv_text.txt'
$doc1.Close()
$doc2 = $word.Documents.Open('C:\Users\Sistemas2\Downloads\000001-BSX640-GLP ANUAL.doc')
$doc2.Content.Text | Out-File 'C:\Users\Sistemas2\Desktop\farenet nuevo proyecto\farenetBackend\scratch\glp_text.txt'
$doc2.Close()
$word.Quit()
