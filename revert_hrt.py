import sys 
with open('/home/vitor_goede/plot_wrf2_copy.py', 'r') as f: content = f.read() 
content = content.replace('salvar_matriz_gz(srh_lm_1.T,', 'salvar_matriz_gz(srh_lm_1,') 
content = content.replace('salvar_matriz_gz(srh_lm_3.T,', 'salvar_matriz_gz(srh_lm_3,') 
with open('/home/vitor_goede/plot_wrf2_copy.py', 'w') as f: f.write(content) 
